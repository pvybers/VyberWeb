import { notFound } from "next/navigation";
import {
  getActionsForWorldState,
  getLatestWorldState,
  getWorld,
  setActionsForWorldState,
  type ActionRow,
} from "@/lib/worldRepo";
import { suggestNextActionsWithGemini } from "@/lib/gemini";
import { WorldClient } from "./worldClient";

export const dynamic = "force-dynamic";

function normalizeWorldPrompt(prompt: string): string {
  const trimmed = prompt.trim();
  if (!trimmed) return trimmed;
  const lines = trimmed.split("\n");
  if (lines[0]?.startsWith("##")) {
    return lines.slice(1).join("\n").trim();
  }
  return trimmed;
}

export default async function WorldPage(props: {
  params: Promise<{ worldId: string }>;
}) {
  const { worldId } = await props.params;

  const world = await getWorld(worldId);
  if (!world) notFound();

  const latest = await getLatestWorldState(worldId);
  if (!latest) notFound();

  let actions: ActionRow[] = await getActionsForWorldState(latest.id);

  // If actions are missing or still using the old hard-coded defaults, regenerate
  // smart suggestions grounded in the latest frame + scene using Gemini.
  const looksLikeLegacyDefaults =
    actions.length === 3 &&
    actions.some((a) => a.label === "Move forward") &&
    actions.some((a) => a.label === "Look around") &&
    actions.some((a) => a.label === "Interact");

  if (actions.length === 0 || looksLikeLegacyDefaults) {
    const smart =
      (await suggestNextActionsWithGemini({
        worldPrompt: normalizeWorldPrompt(world.world_prompt),
        sceneSummary: latest.scene_summary,
        actionPrompt: "The viewer is deciding what to do next in this moment.",
        lastFrameUrl: latest.last_frame_url,
      })) ?? [];

    if (smart.length > 0) {
      actions = await setActionsForWorldState({
        worldStateId: latest.id,
        actions: smart,
      });
    }
  }

  return (
    <WorldClient
      worldId={worldId}
      initialSceneSummary={latest.scene_summary}
      initialVideoUrls={latest.video_urls}
      initialActions={actions.map((a) => ({ label: a.label, prompt: a.prompt }))}
    />
  );
}

