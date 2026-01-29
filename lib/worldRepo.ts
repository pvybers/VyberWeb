import { dbQuery, ensureSchema } from "@/lib/db";
import { newId } from "@/lib/ids";

export type WorldRow = {
  id: string;
  world_prompt: string;
  created_at: Date;
};

export type WorldStateRow = {
  id: string;
  world_id: string;
  video_urls: string[];
  last_frame_url: string;
  scene_summary: string;
  storyboard_id: string | null;
  storyboard_frame_urls: string[] | null;
  parent_state_id: string | null;
  created_at: Date;
};

export type WorldStoryboardRow = {
  id: string;
  world_id: string;
  action_prompt: string;
  frame_urls: string[];
  source_frame_url: string;
  created_at: Date;
};

export type ActionRow = {
  id: string;
  world_state_id: string;
  label: string;
  prompt: string;
};

export async function getWorld(worldId: string): Promise<WorldRow | null> {
  await ensureSchema();
  const res = await dbQuery<WorldRow>("select * from worlds where id = $1", [
    worldId,
  ]);
  return res.rows[0] ?? null;
}

export async function listWorlds(): Promise<WorldRow[]> {
  await ensureSchema();
  const res = await dbQuery<WorldRow>("select * from worlds order by created_at desc");
  return res.rows;
}

export async function createWorld(input: {
  id?: string;
  worldPrompt: string;
}): Promise<WorldRow> {
  await ensureSchema();
  const id = input.id ?? newId();
  const res = await dbQuery<WorldRow>(
    "insert into worlds (id, world_prompt) values ($1, $2) returning *",
    [id, input.worldPrompt],
  );
  return res.rows[0]!;
}

export async function getLatestWorldState(
  worldId: string,
): Promise<WorldStateRow | null> {
  await ensureSchema();
  const res = await dbQuery<WorldStateRow>(
    "select * from world_states where world_id = $1 order by created_at desc limit 1",
    [worldId],
  );
  return res.rows[0] ?? null;
}

export async function getWorldState(stateId: string): Promise<WorldStateRow | null> {
  await ensureSchema();
  const res = await dbQuery<WorldStateRow>("select * from world_states where id = $1", [
    stateId,
  ]);
  return res.rows[0] ?? null;
}

export async function listWorldStates(worldId: string): Promise<WorldStateRow[]> {
  await ensureSchema();
  const res = await dbQuery<WorldStateRow>(
    "select * from world_states where world_id = $1 order by created_at asc",
    [worldId],
  );
  return res.rows;
}

export async function createWorldState(input: {
  id?: string;
  worldId: string;
  videoUrls: string[];
  lastFrameUrl: string;
  sceneSummary: string;
  storyboardId?: string | null;
  storyboardFrameUrls?: string[] | null;
  parentStateId?: string | null;
}): Promise<WorldStateRow> {
  await ensureSchema();
  if (input.videoUrls.length !== 3) {
    throw new Error("worldState.videoUrls must have exactly 3 items");
  }

  const id = input.id ?? newId();
  const res = await dbQuery<WorldStateRow>(
    `insert into world_states (id, world_id, video_urls, last_frame_url, scene_summary, storyboard_id, storyboard_frame_urls, parent_state_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     returning *`,
    [
      id,
      input.worldId,
      input.videoUrls,
      input.lastFrameUrl,
      input.sceneSummary,
      input.storyboardId ?? null,
      input.storyboardFrameUrls ?? null,
      input.parentStateId ?? null,
    ],
  );
  return res.rows[0]!;
}

export async function createWorldStoryboard(input: {
  id?: string;
  worldId: string;
  actionPrompt: string;
  frameUrls: string[];
  sourceFrameUrl: string;
}): Promise<WorldStoryboardRow> {
  await ensureSchema();
  if (input.frameUrls.length !== 4) {
    throw new Error("worldStoryboard.frameUrls must have exactly 4 items");
  }
  const id = input.id ?? newId();
  const res = await dbQuery<WorldStoryboardRow>(
    `insert into world_storyboards (id, world_id, action_prompt, frame_urls, source_frame_url)
     values ($1, $2, $3, $4, $5)
     returning *`,
    [id, input.worldId, input.actionPrompt, input.frameUrls, input.sourceFrameUrl],
  );
  return res.rows[0]!;
}

export async function getWorldStoryboard(
  storyboardId: string,
): Promise<WorldStoryboardRow | null> {
  await ensureSchema();
  const res = await dbQuery<WorldStoryboardRow>(
    "select * from world_storyboards where id = $1",
    [storyboardId],
  );
  return res.rows[0] ?? null;
}

export async function setActionsForWorldState(input: {
  worldStateId: string;
  actions: { label: string; prompt: string }[];
}): Promise<ActionRow[]> {
  await ensureSchema();
  // Simplest behavior: wipe + insert.
  await dbQuery("delete from actions where world_state_id = $1", [
    input.worldStateId,
  ]);

  const inserted: ActionRow[] = [];
  for (const a of input.actions) {
    const res = await dbQuery<ActionRow>(
      "insert into actions (id, world_state_id, label, prompt) values ($1, $2, $3, $4) returning *",
      [newId(), input.worldStateId, a.label, a.prompt],
    );
    inserted.push(res.rows[0]!);
  }
  return inserted;
}

export async function getActionsForWorldState(
  worldStateId: string,
): Promise<ActionRow[]> {
  await ensureSchema();
  const res = await dbQuery<ActionRow>(
    "select * from actions where world_state_id = $1",
    [worldStateId],
  );
  return res.rows;
}

