import { notFound } from "next/navigation";
import {
  getActionsForWorldState,
  getLatestWorldState,
  getWorld,
} from "@/lib/worldRepo";
import { WorldClient } from "./worldClient";

export const dynamic = "force-dynamic";

export default async function WorldPage(props: {
  params: Promise<{ worldId: string }>;
}) {
  const { worldId } = await props.params;

  const world = await getWorld(worldId);
  if (!world) notFound();

  const latest = await getLatestWorldState(worldId);
  if (!latest) notFound();

  const actions = await getActionsForWorldState(latest.id);

  return (
    <WorldClient
      worldId={worldId}
      initialSceneSummary={latest.scene_summary}
      initialVideoUrls={latest.video_urls}
      initialActions={actions.map((a) => ({ label: a.label, prompt: a.prompt }))}
    />
  );
}

