import { NextResponse } from "next/server";
import { z } from "zod";
import { persistStoryboardFrames, splitFourPanelToDataUrls } from "@/lib/external/images";
import { nanoBananaGenerateFourPanel } from "@/lib/external/nanobanana";
import { newId } from "@/lib/ids";
import {
  createWorldStoryboard,
  getLatestWorldState,
  getWorld,
} from "@/lib/worldRepo";

export const runtime = "nodejs";

const StoryboardInput = z.object({
  actionPrompt: z.string().min(1).max(2000),
});

function composePrompt(input: {
  worldPrompt: string;
  sceneSummary: string;
  actionPrompt: string;
}) {
  return [
    input.worldPrompt.trim(),
    "",
    "Current scene:",
    input.sceneSummary.trim(),
    "",
    "User action:",
    input.actionPrompt.trim(),
    "",
    "Generate 4 cinematic frames showing progression.",
    "Frame 1 continues current scene.",
    "Frame 4 completes the action.",
    "Maintain camera, lighting, environment continuity.",
  ].join("\n");
}

function normalizeWorldPrompt(prompt: string): string {
  const trimmed = prompt.trim();
  if (!trimmed) return trimmed;
  const lines = trimmed.split("\n");
  if (lines[0]?.startsWith("##")) {
    return lines.slice(1).join("\n").trim();
  }
  return trimmed;
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ worldId: string }> },
) {
  const { worldId } = await ctx.params;

  console.log("[storyboard] POST /api/worlds/%s/storyboard - start", worldId);

  const body = await req.json().catch(() => null);
  const parsed = StoryboardInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const world = await getWorld(worldId);
  if (!world) {
    console.warn("[storyboard] World not found", { worldId });
    return NextResponse.json({ error: "World not found" }, { status: 404 });
  }

  const latest = await getLatestWorldState(worldId);
  if (!latest) {
    console.warn("[storyboard] World has no state yet", { worldId });
    return NextResponse.json(
      { error: "World has no state yet" },
      { status: 409 },
    );
  }

  const prompt = composePrompt({
    worldPrompt: normalizeWorldPrompt(world.world_prompt),
    sceneSummary: latest.scene_summary,
    actionPrompt: parsed.data.actionPrompt,
  });

  const sourceImageUrl = new URL(latest.last_frame_url, req.url).toString();
  const storyboardId = newId();

  try {
    console.log("[storyboard] Calling NanoBanana with source image", {
      worldId,
      sourceImageUrl,
    });
    const fourPanel = await nanoBananaGenerateFourPanel({
      sourceImageUrl,
      prompt,
    });
    if (!fourPanel?.imageUrl) {
      console.warn("[storyboard] NanoBanana returned no image URL", { worldId });
      return NextResponse.json(
        { error: "storyboard_generation_failed", message: "Storyboard image was not generated." },
        { status: 502 },
      );
    }

    const rawFrames = await splitFourPanelToDataUrls({
      fourPanelImageUrl: fourPanel.imageUrl,
    });
    const frameUrls = await persistStoryboardFrames({
      worldId,
      storyboardId,
      frames: rawFrames,
    });

    await createWorldStoryboard({
      id: storyboardId,
      worldId,
      actionPrompt: parsed.data.actionPrompt,
      frameUrls,
      sourceFrameUrl: sourceImageUrl,
    });

    console.log("[storyboard] Generated storyboard", { worldId, storyboardId });

    return NextResponse.json({
      storyboardId,
      frameUrls,
    });
  } catch (err) {
    console.error("[storyboard] Generation failed", { worldId, error: err });
    return NextResponse.json(
      {
        error: "storyboard_generation_failed",
        message: "Failed to generate storyboard frames for this action.",
      },
      { status: 502 },
    );
  }
}
