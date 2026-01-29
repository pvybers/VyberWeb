import { ensureDataUrl480p } from "@/lib/external/images";
import { createKlingTask, pollKlingTask } from "@/lib/external/kling";
import { seedanceGenerateClip } from "@/lib/external/seedance";

export type VideoGenerationAdapter = {
  name: string;
  generateClips: (input: {
    frames: [string, string, string, string];
    seconds?: number;
    prompt?: string;
  }) => Promise<string[]>;
};

function resolveEngineName(): string {
  return process.env.VIDEO_GEN_MODEL?.trim().toLowerCase() || "seedance";
}

const seedanceAdapter: VideoGenerationAdapter = {
  name: "seedance",
  generateClips: async (input) => {
    const frames = (await Promise.all(input.frames.map((frame) => ensureDataUrl480p(frame)))) as [
      string,
      string,
      string,
      string,
    ];
    const clips = await Promise.all([
      seedanceGenerateClip({ startImage: frames[0], endImage: frames[1], seconds: input.seconds }),
      seedanceGenerateClip({ startImage: frames[1], endImage: frames[2], seconds: input.seconds }),
      seedanceGenerateClip({ startImage: frames[2], endImage: frames[3], seconds: input.seconds }),
    ]);
    if (!clips.every((c) => c?.videoUrl)) {
      throw new Error("Seedance returned missing video URL(s)");
    }
    return clips.map((c) => c!.videoUrl);
  },
};

const klingAdapter: VideoGenerationAdapter = {
  name: "kling",
  generateClips: async (input) => {
    const frames = (await Promise.all(input.frames.map((frame) => ensureDataUrl480p(frame)))) as [
      string,
      string,
      string,
      string,
    ];
    const tasks = await Promise.all([
      createKlingTask({
        startImage: frames[0],
        endImage: frames[1],
        seconds: input.seconds,
        prompt: input.prompt,
      }),
      createKlingTask({
        startImage: frames[1],
        endImage: frames[2],
        seconds: input.seconds,
        prompt: input.prompt,
      }),
      createKlingTask({
        startImage: frames[2],
        endImage: frames[3],
        seconds: input.seconds,
        prompt: input.prompt,
      }),
    ]);

    const clips = await Promise.all(
      tasks.map(async (task, idx) => {
        if (!task) return null;
        if (task.videoUrl) return task.videoUrl;
        if (!task.handle) return null;
        const res = await pollKlingTask({
          taskId: task.handle.taskId,
          headers: task.handle.headers,
          baseUrl: task.handle.baseUrl,
          timeoutMs: 10 * 60_000,
          perRequestTimeoutMs: 5_000,
        });
        if (!res?.videoUrl) {
          throw new Error(`Kling task ${idx + 1} timed out without a video URL`);
        }
        return res.videoUrl;
      }),
    );

    if (!clips.every(Boolean)) {
      throw new Error("Kling returned missing video URL(s)");
    }
    return clips as string[];
  },
};

export function resolveVideoGenerationAdapter(): VideoGenerationAdapter {
  const engine = resolveEngineName();
  if (engine === "kling") return klingAdapter;
  if (engine === "seedance") return seedanceAdapter;
  console.warn("[video] Unknown VIDEO_GEN_MODEL, falling back to seedance", engine);
  return seedanceAdapter;
}
