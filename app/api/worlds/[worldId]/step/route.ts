import { NextResponse } from "next/server";
import { z } from "zod";
import { suggestNextActionsWithGemini } from "@/lib/gemini";
import {
  ensureDataUrl,
  persistStoryboardFrames,
  splitFourPanelToDataUrls,
} from "@/lib/external/images";
import { persistVideoUrls } from "@/lib/external/videos";
import { nanoBananaGenerateFourPanel } from "@/lib/external/nanobanana";
import { seedanceGenerateClip } from "@/lib/external/seedance";
import { newId } from "@/lib/ids";
import {
  createWorldState,
  createWorldStoryboard,
  getLatestWorldState,
  getWorldStoryboard,
  getWorld,
  setActionsForWorldState,
} from "@/lib/worldRepo";

export const runtime = "nodejs";

const StepInput = z.object({
  actionPrompt: z.string().min(1).max(2000),
  storyboardId: z.string().min(1).optional(),
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

  console.log("[step] POST /api/worlds/%s/step - start", worldId);

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
    console.warn("[step] World not found", { worldId });
    return NextResponse.json({ error: "World not found" }, { status: 404 });
  }

  const latest = await getLatestWorldState(worldId);
  if (!latest) {
    console.warn("[step] World has no state yet", { worldId });
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

  console.log("[step] Composed NanoBanana prompt", {
    worldId,
    actionPreview: parsed.data.actionPrompt.slice(0, 80),
    scenePreview: latest.scene_summary.slice(0, 80),
  });

  // 3-5) Optional external generation:
  // - NanoBanana: lastFrameUrl + prompt => 4-panel image
  // - Split + downscale to 480p frames, persist to /data
  // - Seedance: generate 3 clips (1->2, 2->3, 3->4) in parallel
  const sourceImageUrl = new URL(latest.last_frame_url, req.url).toString();
  let frames: [string, string, string, string] | null = null;
  let storyboardId: string | null = null;
  let storyboardFrameUrls: [string, string, string, string] | null = null;

  try {
    if (parsed.data.storyboardId) {
      const storyboard = await getWorldStoryboard(parsed.data.storyboardId);
      if (!storyboard || storyboard.world_id !== worldId) {
        return NextResponse.json(
          { error: "storyboard_not_found", message: "Storyboard not found." },
          { status: 404 },
        );
      }
      storyboardId = storyboard.id;
      storyboardFrameUrls = storyboard.frame_urls as [string, string, string, string];
      frames = storyboardFrameUrls;
      console.log("[step] Using existing storyboard frames", {
        worldId,
        storyboardId,
      });
    } else {
      console.log("[step] Calling NanoBanana with source image", { worldId, sourceImageUrl });
      const fourPanel = await nanoBananaGenerateFourPanel({
        sourceImageUrl,
        prompt,
      });
      if (fourPanel?.imageUrl) {
        console.log("[step] Received 4-panel image URL", {
          worldId,
          imageUrl: fourPanel.imageUrl,
        });
        const rawFrames = await splitFourPanelToDataUrls({
          fourPanelImageUrl: fourPanel.imageUrl,
        });
        const generatedStoryboardId = newId();
        storyboardFrameUrls = await persistStoryboardFrames({
          worldId,
          storyboardId: generatedStoryboardId,
          frames: rawFrames,
        });
        frames = storyboardFrameUrls;
        await createWorldStoryboard({
          id: generatedStoryboardId,
          worldId,
          actionPrompt: parsed.data.actionPrompt,
          frameUrls: storyboardFrameUrls,
          sourceFrameUrl: sourceImageUrl,
        });
        storyboardId = generatedStoryboardId;
        console.log("[step] Persisted storyboard frames", {
          worldId,
          storyboardId,
          frameCount: storyboardFrameUrls.length,
        });
      } else {
        console.warn("[step] NanoBanana returned no image URL", { worldId });
        return NextResponse.json(
          { error: "storyboard_generation_failed", message: "Storyboard image was not generated." },
          { status: 502 },
        );
      }
    }
  } catch (err) {
    console.error("[step] NanoBanana or split failed", {
      worldId,
      error: err,
    });
    return NextResponse.json(
      {
        error: "storyboard_generation_failed",
        message: "Failed to generate storyboard frames for this action.",
      },
      { status: 502 },
    );
  }

  const hasStoryboard = !!frames && new Set(frames).size > 1;

  if (!hasStoryboard) {
    console.warn("[step] No valid storyboard frames", { worldId });
    return NextResponse.json(
      {
        error: "storyboard_generation_failed",
        message: "Invalid storyboard frames generated for this action.",
      },
      { status: 502 },
    );
  }

  const worldStateId = newId();
  let videoUrls: string[] = latest.video_urls;
  try {
    console.log("[step] Calling Seedance for 3 clips in parallel", { worldId });
    const seedanceFrames = (await Promise.all(
      frames.map((frame) => ensureDataUrl(frame)),
    )) as [string, string, string, string];
    const clips = await Promise.all([
      seedanceGenerateClip({ startImage: seedanceFrames[0], endImage: seedanceFrames[1], seconds: 5 }),
      seedanceGenerateClip({ startImage: seedanceFrames[1], endImage: seedanceFrames[2], seconds: 5 }),
      seedanceGenerateClip({ startImage: seedanceFrames[2], endImage: seedanceFrames[3], seconds: 5 }),
    ]);
    if (!clips.every((c) => c?.videoUrl)) {
      console.error("[step] One or more Seedance clips missing videoUrl", { worldId, clips });
      return NextResponse.json(
        {
          error: "video_generation_failed",
          message: "Failed to generate all video clips for this action.",
        },
        { status: 502 },
      );
    }
    videoUrls = clips.map((c) => c!.videoUrl);
    videoUrls = await persistVideoUrls({
      worldId,
      worldStateId,
      videoUrls,
    });
    console.log("[step] Seedance clips ready", {
      worldId,
      videoUrls,
    });
  } catch (err) {
    console.error("[step] Seedance generation failed", {
      worldId,
      error: err,
    });
    return NextResponse.json(
      {
        error: "video_generation_failed",
        message:
          "Failed to generate video clips for this action. Please try again or adjust your action.",
      },
      { status: 502 },
    );
  }
  const sceneSummary = `${latest.scene_summary}\n\nUser did: ${parsed.data.actionPrompt}`.slice(
    0,
    2000,
  );

  // Guard against storing huge data URLs in DB.
  const lastFrameUrl =
    frames[3].startsWith("data:") && frames[3].length >= 250_000 ? sourceImageUrl : frames[3];

  const newState = await createWorldState({
    id: worldStateId,
    worldId,
    videoUrls,
    lastFrameUrl,
    sceneSummary,
    storyboardId,
    storyboardFrameUrls,
  });

  const actions =
    (await suggestNextActionsWithGemini({
      worldPrompt: normalizeWorldPrompt(world.world_prompt),
      sceneSummary: latest.scene_summary,
      actionPrompt: parsed.data.actionPrompt,
      lastFrameUrl,
    })) ?? (await suggestActionsFallback(parsed.data.actionPrompt));

  console.log("[step] Suggested actions", {
    worldId,
    actionCount: actions.length,
    labels: actions.map((a) => a.label),
  });

  await setActionsForWorldState({ worldStateId: newState.id, actions });

  return NextResponse.json({
    videoUrls,
    actions,
    sceneSummary: newState.scene_summary,
  });
}

