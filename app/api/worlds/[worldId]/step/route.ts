import { NextResponse } from "next/server";
import { z } from "zod";
import { suggestNextActionsWithGemini } from "@/lib/gemini";
import { splitFourPanelToDataUrls } from "@/lib/external/images";
import { nanoBananaGenerateFourPanel } from "@/lib/external/nanobanana";
import { seedanceGenerateClip } from "@/lib/external/seedance";
import {
  createWorldState,
  getLatestWorldState,
  getWorld,
  setActionsForWorldState,
} from "@/lib/worldRepo";

export const runtime = "nodejs";

const StepInput = z.object({
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

async function suggestActionsFallback(actionPrompt: string) {
  // Lightweight, deterministic fallback if no LLM is wired.
  const base = actionPrompt.slice(0, 80);
  return [
    { label: "Continue", prompt: `Continue the moment after: ${base}` },
    { label: "Look around", prompt: "Look around for new details and threats." },
    { label: "Take cover", prompt: "Take cover and assess the situation safely." },
    { label: "Change plan", prompt: "Do something unexpected that still fits the scene." },
  ];
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ worldId: string }> },
) {
  const { worldId } = await ctx.params;

  const body = await req.json().catch(() => null);
  const parsed = StepInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const world = await getWorld(worldId);
  if (!world) {
    return NextResponse.json({ error: "World not found" }, { status: 404 });
  }

  const latest = await getLatestWorldState(worldId);
  if (!latest) {
    return NextResponse.json(
      { error: "World has no state yet" },
      { status: 409 },
    );
  }

  const prompt = composePrompt({
    worldPrompt: world.world_prompt,
    sceneSummary: latest.scene_summary,
    actionPrompt: parsed.data.actionPrompt,
  });

  // 3-5) Optional external generation:
  // - NanoBanana: lastFrameUrl + prompt => 4-panel image
  // - Split the 4-panel image into 4 frames (data URLs)
  // - Seedance: generate 3 clips (1->2, 2->3, 3->4) in parallel
  const sourceImageUrl = new URL(latest.last_frame_url, req.url).toString();
  let frames: [string, string, string, string] | null = null;

  try {
    const fourPanel = await nanoBananaGenerateFourPanel({
      sourceImageUrl,
      prompt,
    });
    if (fourPanel?.imageUrl) {
      frames = await splitFourPanelToDataUrls({ fourPanelImageUrl: fourPanel.imageUrl });
    }
  } catch {
    // Ignore: fall back to placeholders.
  }

  if (!frames) frames = [sourceImageUrl, sourceImageUrl, sourceImageUrl, sourceImageUrl];

  let videoUrls: string[] = latest.video_urls;
  try {
    const clips = await Promise.all([
      seedanceGenerateClip({ startImage: frames[0], endImage: frames[1], seconds: 5 }),
      seedanceGenerateClip({ startImage: frames[1], endImage: frames[2], seconds: 5 }),
      seedanceGenerateClip({ startImage: frames[2], endImage: frames[3], seconds: 5 }),
    ]);
    if (clips.every((c) => c?.videoUrl)) {
      videoUrls = clips.map((c) => c!.videoUrl);
    }
  } catch {
    // Ignore: keep previous clips if Seedance isn't configured/available.
  }
  const sceneSummary = `${latest.scene_summary}\n\nUser did: ${parsed.data.actionPrompt}`.slice(
    0,
    2000,
  );

  // Guard against storing huge data URLs in DB.
  const lastFrameUrl =
    frames[3].startsWith("data:") && frames[3].length >= 250_000 ? sourceImageUrl : frames[3];

  const newState = await createWorldState({
    worldId,
    videoUrls,
    lastFrameUrl,
    sceneSummary,
  });

  const actions =
    (await suggestNextActionsWithGemini({
      worldPrompt: world.world_prompt,
      sceneSummary: latest.scene_summary,
      actionPrompt: parsed.data.actionPrompt,
    })) ?? (await suggestActionsFallback(parsed.data.actionPrompt));

  await setActionsForWorldState({ worldStateId: newState.id, actions });

  return NextResponse.json({
    videoUrls,
    actions,
    sceneSummary: newState.scene_summary,
  });
}

