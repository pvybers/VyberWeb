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

function resolveSeedanceBase(): string {
  return (
    process.env.SEEDANCE_API_BASE?.trim() ||
    process.env.SEEDREAM_API_BASE?.trim() ||
    ARK_BASE
  );
}

function formatAuthHeader(apiKey: string): string {
  if (apiKey.toLowerCase().startsWith("bearer ")) return apiKey;
  return `Bearer ${apiKey}`;
}

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

function findFirstVideoUrl(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") {
    if (value.startsWith("http://") || value.startsWith("https://")) {
      if (value.toLowerCase().includes(".mp4") || value.includes("/video")) return value;
    }
    return null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirstVideoUrl(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      const found = findFirstVideoUrl(v);
      if (found) return found;
    }
  }
  return null;
}

let debugTaskQueue: string[] | null = null;

function parseDebugTaskIds(): string[] {
  const raw =
    process.env.SEEDANCE_DEBUG_TASK_IDS?.trim() ??
    process.env.SEEDREAM_DEBUG_TASK_IDS?.trim() ??
    "";
  if (!raw) return [];
  return raw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

function isTaskFinished(json: z.infer<typeof SeedanceTaskResponse>): boolean {
  const s = (json.status ?? json.task_status ?? "").toUpperCase();
  return s === "SUCCEEDED" || s === "SUCCESS" || s === "FINISHED";
}

function isTaskFailed(json: z.infer<typeof SeedanceTaskResponse>): boolean {
  const s = (json.status ?? json.task_status ?? "").toUpperCase();
  return s === "FAILED" || s === "ERROR";
}

function isStatusFinished(status?: string): boolean {
  const s = (status ?? "").toUpperCase();
  return s === "SUCCEEDED" || s === "SUCCESS" || s === "FINISHED";
}

function isStatusFailed(status?: string): boolean {
  const s = (status ?? "").toUpperCase();
  return s === "FAILED" || s === "ERROR";
}

/**
 * Thin adapter for ByteDance Seedance (ARK) video generation.
 *
 * - Uses ARK base URL `https://ark.cn-beijing.volces.com/api/v3`
 * - Only requires `ARK_API_KEY` (or `SEEDANCE_API_KEY` for compatibility)
 * - Creates a task at `/contents/generations/tasks`, then polls same path with task id
 */
export async function seedanceGenerateClip(input: {
  startImage: string;
  endImage: string;
  seconds?: number;
}): Promise<{ videoUrl: string } | null> {
  const apiKey =
    process.env.ARK_API_KEY?.trim() ??
    process.env.SEEDANCE_API_KEY?.trim() ??
    process.env.SEEDREAM_API_KEY?.trim() ??
    null;
  if (!apiKey) return null;

  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: formatAuthHeader(apiKey),
  };

  console.log("[seedance] Creating generation task", {
    seconds: input.seconds ?? 5,
    hasStartImage: Boolean(input.startImage),
    hasEndImage: Boolean(input.endImage),
  });

  if (debugTaskQueue === null) {
    debugTaskQueue = parseDebugTaskIds();
  }
  if (debugTaskQueue.length > 0) {
    const taskId = debugTaskQueue.shift()!;
    console.warn("[seedance][debug] Using hardcoded task id", { taskId });
    return await pollSeedanceTask({ taskId, headers });
  }

  // 1) Create generation task.
  const baseUrl = resolveSeedanceBase();
  const modelName =
    process.env.SEEDANCE_MODEL?.trim() ||
    process.env.SEEDREAM_MODEL?.trim() ||
    "doubao-seedance-1-5-pro-251215";
  const createRes = await fetch(`${baseUrl}/contents/generations/tasks`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: modelName,
      content: [
        {
          type: "text",
          text: `Generate a cinematic 5-second clip. --dur ${input.seconds ?? 5}`,
        },
        {
          type: "image_url",
          image_url: {
            url: input.startImage,
          },
          role: "first_frame",
        },
        {
          type: "image_url",
          image_url: {
            url: input.endImage,
          },
          role: "last_frame",
        },
      ],
    }),
  });

  if (!createRes.ok) {
    const text = await createRes.text().catch(() => "<no body>");
    console.error("[seedance] Create HTTP error", createRes.status, text);
    throw new Error(`Seedance create failed: ${createRes.status} ${text}`);
  }

  const createJson = await createRes.json().catch(() => null);
  console.log("[seedance] Create response", createJson);
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
  return await pollSeedanceTask({ taskId, headers, baseUrl });
}

async function pollSeedanceTask(input: {
  taskId: string;
  headers: Record<string, string>;
  baseUrl?: string;
}): Promise<{ videoUrl: string } | null> {
  const baseUrl = input.baseUrl ?? resolveSeedanceBase();
  const taskId = input.taskId;
  const headers = input.headers;
  const pollUrl = `${baseUrl}/contents/generations/tasks/${taskId}`;
  const started = Date.now();
  // Allow several minutes to accommodate slower generations.
  const timeoutMs = 3 * 60_000;

  console.log("[seedance] Polling task", { taskId, pollUrl, timeoutMs });

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (Date.now() - started > timeoutMs) {
      return null;
    }

    await sleep(1500);

    const pollRes = await fetch(pollUrl, { headers });
    if (!pollRes.ok) {
      // Transient failure; keep trying until timeout.
      console.warn("[seedance] Poll HTTP error, will retry", pollRes.status);
      continue;
    }

    const pollJson = await pollRes.json().catch(() => null);
    if (!pollJson) continue;
    const parsed = SeedanceTaskResponse.safeParse(pollJson);
    if (!parsed.success) {
      console.warn("[seedance] Poll parse failed, using raw scan", {
        taskId,
        keys: Object.keys(pollJson ?? {}),
      });
    }

    const status = parsed.success
      ? parsed.data.status ?? parsed.data.task_status
      : (pollJson?.status ?? pollJson?.task_status);
    console.log("[seedance] Poll status", { taskId, status });

    if (parsed.success && isTaskFailed(parsed.data)) {
      console.error("[seedance] Task failed", { taskId, status });
      return null;
    }
    if (parsed.success && !isTaskFinished(parsed.data)) continue;
    if (!parsed.success) {
      if (isStatusFailed(status)) {
        console.error("[seedance] Task failed (raw)", { taskId, status });
        return null;
      }
      if (!isStatusFinished(status)) continue;
    }

    const videoUrl = parsed.success
      ? pickVideoUrlFromTask(parsed.data)
      : null;
    const fallbackUrl = findFirstVideoUrl(pollJson);
    const finalUrl = videoUrl ?? fallbackUrl;
    if (!finalUrl) {
      console.error("[seedance] Task finished but no video URL found", {
        taskId,
        status,
        keys: Object.keys(pollJson ?? {}),
      });
      return null;
    }
    console.log("[seedance] Task succeeded with video", { taskId, videoUrl: finalUrl });
    return { videoUrl: finalUrl };
  }
}

