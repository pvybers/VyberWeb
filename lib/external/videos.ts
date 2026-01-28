import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

function normalizeAssetUrl(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  const base = process.env.APP_ORIGIN?.trim() || "http://127.0.0.1:3000";
  if (url.startsWith("/")) return `${base}${url}`;
  return `${base}/${url}`;
}

async function fetchVideoBuffer(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(normalizeAssetUrl(url));
    if (!res.ok) {
      console.warn("[videos] Failed to fetch video", res.status, url);
      return null;
    }
    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  } catch (err) {
    console.warn("[videos] Error fetching video", err);
    return null;
  }
}

export async function persistVideoUrls(input: {
  worldId: string;
  worldStateId: string;
  videoUrls: string[];
}): Promise<string[]> {
  const baseDir = join(process.cwd(), "data", "vid", input.worldId, input.worldStateId);
  await mkdir(baseDir, { recursive: true });

  const stored: string[] = [];
  for (let i = 0; i < input.videoUrls.length; i += 1) {
    const url = input.videoUrls[i]!;
    const buf = await fetchVideoBuffer(url);
    if (!buf) {
      stored.push(url);
      continue;
    }
    const filename = `clip${i + 1}.mp4`;
    const filePath = join(baseDir, filename);
    await writeFile(filePath, buf);
    stored.push(`/data/vid/${input.worldId}/${input.worldStateId}/${filename}`);
  }

  return stored;
}
