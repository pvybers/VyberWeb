import { z } from "zod";

const SeedanceTaskResponse = z
  .object({
    id: z.string().optional(),
    task_id: z.string().optional(),
    taskId: z.string().optional(),
    status: z.string().optional(),
    task_status: z.string().optional(),
    output: z
      .object({
        video_url: z.string().url().optional(),
        videoUrl: z.string().url().optional(),
        url: z.string().url().optional(),
      })
      .optional(),
  })
  .passthrough();

const SeedanceImmediateResponse = z
  .object({
    video_url: z.string().url().optional(),
    videoUrl: z.string().url().optional(),
    url: z.string().url().optional(),
  })
  .passthrough();

const ARK_BASE = "https://ark.cn-beijing.volces.com/api/v3";

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function pickTaskId(json: z.infer<typeof SeedanceTaskResponse>): string | null {
  return json.taskId ?? json.task_id ?? json.id ?? null;
}

function pickVideoUrlFromTask(json: z.infer<typeof SeedanceTaskResponse>): string | null {
  const o = json.output;
  if (!o) return null;
  return o.video_url ?? o.videoUrl ?? o.url ?? null;
}

function isTaskFinished(json: z.infer<typeof SeedanceTaskResponse>): boolean {
  const s = (json.status ?? json.task_status ?? "").toUpperCase();
  return s === "SUCCEEDED" || s === "SUCCESS" || s === "FINISHED";
}

function isTaskFailed(json: z.infer<typeof SeedanceTaskResponse>): boolean {
  const s = (json.status ?? json.task_status ?? "").toUpperCase();
  return s === "FAILED" || s === "ERROR";
}

/**
 * Thin adapter for ByteDance Seedance (ARK) video generation.
 *
 * - Uses ARK base URL `https://ark.cn-beijing.volces.com/api/v3`
 * - Only requires `ARK_API_KEY` (or `SEEDANCE_API_KEY` for compatibility)
 * - Creates a task, then polls `/contents/generations/tasks/{id}` until ready or timeout
 */
export async function seedanceGenerateClip(input: {
  startImage: string;
  endImage: string;
  seconds?: number;
}): Promise<{ videoUrl: string } | null> {
  const apiKey =
    process.env.ARK_API_KEY?.trim() ?? process.env.SEEDANCE_API_KEY?.trim() ?? null;
  if (!apiKey) return null;

  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${apiKey}`,
  };

  // 1) Create generation task.
  const createRes = await fetch(`${ARK_BASE}/contents/generations`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      // These fields are intentionally generic; adjust to your concrete Seedance model.
      // You can inspect the raw JSON in your own logs and tweak as needed.
      type: "video",
      start_image: input.startImage,
      end_image: input.endImage,
      startImage: input.startImage,
      endImage: input.endImage,
      seconds: input.seconds ?? 5,
      // Hint for 16:9 480p-style output; real field name may differ but this is harmless.
      resolution: "854x480",
      width: 854,
      height: 480,
    }),
  });

  if (!createRes.ok) {
    throw new Error(`Seedance create failed: ${createRes.status} ${await createRes.text()}`);
  }

  const createJson = await createRes.json().catch(() => null);
  if (!createJson) return null;

  // If the API sometimes responds synchronously with a video URL, handle that fast-path.
  const immediate = SeedanceImmediateResponse.safeParse(createJson);
  if (immediate.success) {
    const v =
      immediate.data.video_url ?? immediate.data.videoUrl ?? immediate.data.url ?? null;
    if (v) return { videoUrl: v };
  }

  const createTask = SeedanceTaskResponse.safeParse(createJson);
  if (!createTask.success) return null;

  const taskId = pickTaskId(createTask.data);
  if (!taskId) return null;

  // 2) Poll task until finished or timeout.
  const pollUrl = `${ARK_BASE}/contents/generations/tasks/${taskId}`;
  const started = Date.now();
  const timeoutMs = 60_000;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (Date.now() - started > timeoutMs) {
      return null;
    }

    await sleep(1500);

    const pollRes = await fetch(pollUrl, { headers });
    if (!pollRes.ok) {
      // Transient failure; keep trying until timeout.
      continue;
    }

    const pollJson = await pollRes.json().catch(() => null);
    if (!pollJson) continue;
    const parsed = SeedanceTaskResponse.safeParse(pollJson);
    if (!parsed.success) continue;

    if (isTaskFailed(parsed.data)) return null;
    if (!isTaskFinished(parsed.data)) continue;

    const videoUrl = pickVideoUrlFromTask(parsed.data);
    if (!videoUrl) return null;
    return { videoUrl };
  }
}

