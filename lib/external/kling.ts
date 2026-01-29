import { createHmac } from "node:crypto";
import { z } from "zod";

const KlingCreateResponse = z
  .object({
    data: z
      .object({
        task_id: z.string().optional(),
        taskId: z.string().optional(),
        status: z.string().optional(),
        video_url: z.string().url().optional(),
        videoUrl: z.string().url().optional(),
        url: z.string().url().optional(),
      })
      .optional(),
  })
  .passthrough();

const KlingTaskResponse = z
  .object({
    data: z
      .object({
        task_id: z.string().optional(),
        taskId: z.string().optional(),
        status: z.string().optional(),
        task_status: z.string().optional(),
        video_url: z.string().url().optional(),
        videoUrl: z.string().url().optional(),
        url: z.string().url().optional(),
        videos: z.array(z.string().url()).optional(),
        output: z.record(z.string(), z.unknown()).optional(),
        task_result: z
          .object({
            videos: z
              .array(
                z.object({
                  id: z.string().optional(),
                  url: z.string().optional(),
                  duration: z.string().optional(),
                }),
              )
              .optional(),
          })
          .optional(),
      })
      .optional(),
  })
  .passthrough();

function formatAuthHeader(token: string): string {
  if (token.toLowerCase().startsWith("bearer ")) return token;
  return `Bearer ${token}`;
}

function base64Url(input: string | Buffer): string {
  const raw = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return raw
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function createJwtToken(accessKey: string, secretKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const ttlSeconds = Number(process.env.KLING_TOKEN_TTL_SECONDS ?? "1800");
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    iss: accessKey,
    iat: now,
    nbf: now - 5,
    exp: now + Math.max(60, ttlSeconds),
  };

  const headerB64 = base64Url(JSON.stringify(header));
  const payloadB64 = base64Url(JSON.stringify(payload));
  const signature = createHmac("sha256", secretKey)
    .update(`${headerB64}.${payloadB64}`)
    .digest();
  const signatureB64 = base64Url(signature);
  return `${headerB64}.${payloadB64}.${signatureB64}`;
}

function resolveAuthHeader(): string {
  const accessKey = process.env.KLING_ACCESS_KEY?.trim();
  const secretKey = process.env.KLING_SECRET_KEY?.trim();
  if (!accessKey || !secretKey) {
    throw new Error("Missing KLING_ACCESS_KEY or KLING_SECRET_KEY");
  }
  return formatAuthHeader(createJwtToken(accessKey, secretKey));
}

function resolveBaseUrl(): string {
  return process.env.KLING_API_BASE?.trim() || "https://api-beijing.klingai.com";
}

function resolveCreatePath(): string {
  return process.env.KLING_CREATE_PATH?.trim() || "/v1/videos/image2video";
}

function resolveTaskPath(taskId: string): string {
  const template =
    process.env.KLING_TASK_PATH?.trim() || "/v1/videos/image2video/{taskId}";
  return template.replace("{taskId}", taskId);
}

function normalizeError(err: unknown) {
  if (err instanceof Error) {
    const cause =
      err.cause instanceof Error
        ? { name: err.cause.name, message: err.cause.message }
        : err.cause;
    return { name: err.name, message: err.message, stack: err.stack, cause };
  }
  return { value: err };
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function logKlingError(message: string, details: Record<string, unknown>) {
  console.error(`[kling] ${message}`, details);
}

function parseMaybeJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function computeRetryDelayMs(status: number, bodyText: string, attempt: number): number {
  if (status === 429) {
    const parsed = parseMaybeJson(bodyText) as { code?: number } | null;
    if (parsed?.code === 1303) {
      return 3000 + attempt * 1000;
    }
  }
  return 700 * attempt;
}

function pickTaskId(value: z.infer<typeof KlingCreateResponse> | z.infer<typeof KlingTaskResponse>) {
  return value.data?.taskId ?? value.data?.task_id ?? null;
}

function pickVideoUrl(value: z.infer<typeof KlingTaskResponse>): string | null {
  const data = value.data;
  if (!data) return null;
  return data.video_url ?? data.videoUrl ?? data.url ?? data.videos?.[0] ?? null;
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

function normalizeVideoUrl(baseUrl: string, value: string): string {
  if (value.startsWith("http://") || value.startsWith("https://")) return value;
  if (value.startsWith("/")) return `${baseUrl}${value}`;
  return `${baseUrl}/v1/files/${value}`;
}

function normalizeImageInput(value: string): string {
  if (value.startsWith("data:")) {
    const match = /^data:[^;]+;base64,(.+)$/.exec(value);
    if (match) return match[1]!;
  }
  return value;
}

function isStatusFinished(status?: string): boolean {
  const s = (status ?? "").toUpperCase();
  return (
    s === "SUCCEEDED" ||
    s === "SUCCESS" ||
    s === "SUCCEED" ||
    s === "FINISHED" ||
    s === "COMPLETED"
  );
}

function isStatusFailed(status?: string): boolean {
  const s = (status ?? "").toUpperCase();
  return s === "FAILED" || s === "ERROR";
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

export type KlingTaskHandle = {
  taskId: string;
  headers: Record<string, string>;
  baseUrl: string;
};

export async function createKlingTask(input: {
  startImage: string;
  endImage: string;
  seconds?: number;
  prompt?: string;
  negativePrompt?: string;
}): Promise<{ handle?: KlingTaskHandle; videoUrl?: string } | null> {
  const authHeader = resolveAuthHeader();

  const baseUrl = resolveBaseUrl();
  const createUrl = `${baseUrl}${resolveCreatePath()}`;
  const body: Record<string, unknown> = {
    model_name: "kling-v2-5-turbo",
    image: normalizeImageInput(input.startImage),
    image_tail: normalizeImageInput(input.endImage),
    duration: input.seconds ?? 5,
    mode: "pro",
  };
  if (input.prompt) body.prompt = input.prompt;
  if (input.negativePrompt) body.negative_prompt = input.negativePrompt;

  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: authHeader,
  };

  console.log("[kling] Creating image2video task", {
    hasStartImage: Boolean(input.startImage),
    hasEndImage: Boolean(input.endImage),
    seconds: input.seconds ?? 5,
  });

  const maxAttempts = Math.max(1, Number(process.env.KLING_CREATE_ATTEMPTS ?? "3"));
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let createRes: Response;
    try {
      createRes = await fetch(createUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
    } catch (err) {
      logKlingError("Create request failed", {
        attempt,
        maxAttempts,
        error: normalizeError(err),
      });
      if (attempt < maxAttempts) {
        await sleep(600 * attempt);
        continue;
      }
      throw new Error("Kling create request failed after retries.");
    }

    if (!createRes.ok) {
      const text = await createRes.text().catch(() => "<no body>");
      const parsedBody = parseMaybeJson(text);
      logKlingError("Create HTTP error", {
        attempt,
        maxAttempts,
        status: createRes.status,
        body: parsedBody ?? text,
      });
      if (attempt < maxAttempts && isRetryableStatus(createRes.status)) {
        const delayMs = computeRetryDelayMs(createRes.status, text, attempt);
        await sleep(delayMs);
        continue;
      }
      throw new Error(`Kling create failed: ${createRes.status} ${text}`);
    }

    const createJson = await createRes.json().catch(() => null);
    if (!createJson) {
      logKlingError("Create JSON parse failed", { attempt, maxAttempts });
      return null;
    }

    const parsed = KlingCreateResponse.safeParse(createJson);
    if (!parsed.success) {
      console.warn("[kling] Create parse failed, using raw scan");
    }

    const taskId = parsed.success ? pickTaskId(parsed.data) : null;
    if (!taskId) {
      const immediateUrl = findFirstVideoUrl(createJson);
      if (immediateUrl) {
        return { videoUrl: normalizeVideoUrl(baseUrl, immediateUrl) };
      }
      logKlingError("Create response missing task id", {
        attempt,
        maxAttempts,
        response: createJson,
      });
      return null;
    }

    return { handle: { taskId, headers, baseUrl } };
  }

  return null;
}

export async function pollKlingTask(input: {
  taskId: string;
  headers: Record<string, string>;
  baseUrl?: string;
  timeoutMs?: number;
  perRequestTimeoutMs?: number;
}): Promise<{ videoUrl: string } | null> {
  const baseUrl = input.baseUrl ?? resolveBaseUrl();
  const taskUrl = `${baseUrl}${resolveTaskPath(input.taskId)}`;
  const started = Date.now();
  const timeoutMs = input.timeoutMs ?? 10 * 60_000;
  const perRequestTimeoutMs = input.perRequestTimeoutMs ?? 5_000;

  console.log("[kling] Polling task", { taskId: input.taskId, taskUrl, timeoutMs });

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (Date.now() - started > timeoutMs) return null;

    await sleep(1500);

    let pollRes: Response;
    try {
      pollRes = await fetchWithTimeout(taskUrl, { headers: input.headers }, perRequestTimeoutMs);
    } catch (err) {
      console.warn("[kling] Poll fetch failed, retrying", {
        taskId: input.taskId,
        error: normalizeError(err),
      });
      continue;
    }
    if (!pollRes.ok) {
      const text = await pollRes.text().catch(() => "<no body>");
      console.warn("[kling] Poll HTTP error, retrying", {
        taskId: input.taskId,
        status: pollRes.status,
        body: text,
      });
      continue;
    }

    const pollJson = await pollRes.json().catch(() => null);
    if (!pollJson) continue;

    const parsed = KlingTaskResponse.safeParse(pollJson);
    const status = parsed.success
      ? parsed.data.data?.status ?? parsed.data.data?.task_status
      : (pollJson?.data?.status ?? pollJson?.data?.task_status);
    if (isStatusFailed(status)) {
      console.error("[kling] Task failed", {
        taskId: input.taskId,
        status,
        response: parsed.success ? parsed.data : pollJson,
      });
      return null;
    }
    if (!isStatusFinished(status)) continue;

    const videoUrl = parsed.success ? pickVideoUrl(parsed.data) : null;
    const resultUrl =
      parsed.success ? parsed.data.data?.task_result?.videos?.[0]?.url : undefined;
    const fallbackUrl = findFirstVideoUrl(pollJson);
    const rawUrl = videoUrl ?? resultUrl ?? fallbackUrl;
    const finalUrl = rawUrl ? normalizeVideoUrl(baseUrl, rawUrl) : null;
    if (!finalUrl) {
      console.error("[kling] Task finished but no video URL found", {
        taskId: input.taskId,
        status,
      });
      return null;
    }
    console.log("[kling] Task succeeded with video", { taskId: input.taskId, videoUrl: finalUrl });
    return { videoUrl: finalUrl };
  }
}

export async function klingGenerateClip(input: {
  startImage: string;
  endImage: string;
  seconds?: number;
  prompt?: string;
  negativePrompt?: string;
}): Promise<{ videoUrl: string } | null> {
  const created = await createKlingTask(input);
  if (!created) return null;
  if (created.videoUrl) return { videoUrl: created.videoUrl };
  if (!created.handle) return null;
  return await pollKlingTask({
    taskId: created.handle.taskId,
    headers: created.handle.headers,
    baseUrl: created.handle.baseUrl,
  });
}
