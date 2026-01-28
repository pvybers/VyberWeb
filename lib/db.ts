import { Pool, type QueryResult, type QueryResultRow } from "pg";

let _pool: Pool | null = null;

export function dbPool(): Pool {
  if (_pool) return _pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "Missing DATABASE_URL. Set it in .env (Neon Postgres connection string).",
    );
  }

  _pool = new Pool({
    connectionString,
    // Neon requires TLS. Most Neon connection strings include `sslmode=require`,
    // but enabling SSL here is the most portable.
    ssl: { rejectUnauthorized: false },
    max: 5,
  });

  return _pool;
}

export async function dbQuery<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  const pool = dbPool();
  return await pool.query<T>(text, params);
}

/**
 * Lightweight schema bootstrap (no migration framework yet).
 * Safe to call multiple times.
 */
export async function ensureSchema(): Promise<void> {
  await dbQuery(`
    create table if not exists worlds (
      id text primary key,
      world_prompt text not null,
      created_at timestamptz not null default now()
    );

    create table if not exists world_states (
      id text primary key,
      world_id text not null references worlds(id) on delete cascade,
      video_urls text[] not null,
      last_frame_url text not null,
      scene_summary text not null,
      created_at timestamptz not null default now(),
      constraint world_states_video_urls_len check (array_length(video_urls, 1) = 3)
    );

    create index if not exists world_states_world_id_created_at_idx
      on world_states(world_id, created_at desc);

    create table if not exists actions (
      id text primary key,
      world_state_id text not null references world_states(id) on delete cascade,
      label text not null,
      prompt text not null
    );

    create index if not exists actions_world_state_id_idx
      on actions(world_state_id);

    create table if not exists world_storyboards (
      id text primary key,
      world_id text not null references worlds(id) on delete cascade,
      action_prompt text not null,
      frame_urls text[] not null,
      source_frame_url text not null,
      created_at timestamptz not null default now(),
      constraint world_storyboards_frame_urls_len check (array_length(frame_urls, 1) = 4)
    );

    create index if not exists world_storyboards_world_id_created_at_idx
      on world_storyboards(world_id, created_at desc);

    alter table world_states
      add column if not exists storyboard_id text references world_storyboards(id) on delete set null;

    alter table world_states
      add column if not exists storyboard_frame_urls text[];
  `);
}

