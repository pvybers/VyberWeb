import { NextResponse } from "next/server";
import {
  getActionsForWorldState,
  getWorld,
  listWorldStates,
} from "@/lib/worldRepo";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ worldId: string }> },
) {
  const { worldId } = await ctx.params;
  const world = await getWorld(worldId);
  if (!world) {
    return NextResponse.json({ error: "World not found" }, { status: 404 });
  }

  const states = await listWorldStates(worldId);
  const actionsByState = await Promise.all(
    states.map(async (state) => ({
      stateId: state.id,
      actions: await getActionsForWorldState(state.id),
    })),
  );
  const actionsMap = new Map(actionsByState.map((entry) => [entry.stateId, entry.actions]));

  return NextResponse.json({
    states: states.map((state) => ({
      id: state.id,
      createdAt: state.created_at,
      sceneSummary: state.scene_summary,
      videoUrls: state.video_urls,
      parentStateId: state.parent_state_id,
      actions: (actionsMap.get(state.id) ?? []).map((a) => ({
        label: a.label,
        prompt: a.prompt,
      })),
    })),
  });
}
