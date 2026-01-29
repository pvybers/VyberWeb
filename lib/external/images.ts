import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

function toDataUrlPng(buf: Buffer): string {
  return `data:image/png;base64,${buf.toString("base64")}`;
}

function normalizeAssetUrl(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  const base = process.env.APP_ORIGIN?.trim() || "http://127.0.0.1:3000";
  if (url.startsWith("/")) return `${base}${url}`;
  return `${base}/${url}`;
}

async function dataUrlToBuffer(input: string): Promise<{ buffer: Buffer; mimeType: string }> {
  if (input.startsWith("data:")) {
    const match = /^data:([^;]+);base64,(.+)$/.exec(input);
    if (!match) {
      throw new Error("Unsupported data URL format");
    }
    const [, mimeType, data] = match;
    return { buffer: Buffer.from(data, "base64"), mimeType };
  }

  const res = await fetch(normalizeAssetUrl(input));
  if (!res.ok) {
    throw new Error(`Failed to download image: ${res.status}`);
  }
  const mimeType = res.headers.get("content-type") ?? "image/png";
  const arrayBuf = await res.arrayBuffer();
  return { buffer: Buffer.from(arrayBuf), mimeType };
}

export async function ensureDataUrl(input: string): Promise<string> {
  if (input.startsWith("data:")) return input;
  const { buffer, mimeType } = await dataUrlToBuffer(input);
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

export async function ensureDataUrl480p(input: string): Promise<string> {
  const { buffer } = await dataUrlToBuffer(input);
  const resized = await resizeTo480pPng(buffer);
  return toDataUrlPng(resized);
}

async function resizeTo480pPng(input: Buffer): Promise<Buffer> {
  // Force a 16:9 480p output for lightweight previews and storage.
  return await sharp(input)
    .resize(854, 480, { fit: "cover", position: "centre" })
    .png()
    .toBuffer();
}

export async function splitFourPanelToDataUrls(input: {
  fourPanelImageUrl: string;
}): Promise<[string, string, string, string]> {
  const res = await fetch(input.fourPanelImageUrl);
  if (!res.ok) {
    throw new Error(
      `Failed to download 4-panel image: ${res.status} ${await res.text()}`,
    );
  }
  const arrayBuf = await res.arrayBuffer();
  const buf = Buffer.from(arrayBuf);

  const img = sharp(buf);
  const meta = await img.metadata();
  if (!meta.width || !meta.height) throw new Error("Missing image dimensions");

  // Assume a simple 2x2 grid.
  const w = meta.width;
  const h = meta.height;
  const halfW = Math.floor(w / 2);
  const halfH = Math.floor(h / 2);

  const f1 = await img
    .clone()
    .extract({ left: 0, top: 0, width: halfW, height: halfH })
    .png()
    .toBuffer();
  const f2 = await img
    .clone()
    .extract({ left: halfW, top: 0, width: w - halfW, height: halfH })
    .png()
    .toBuffer();
  const f3 = await img
    .clone()
    .extract({ left: 0, top: halfH, width: halfW, height: h - halfH })
    .png()
    .toBuffer();
  const f4 = await img
    .clone()
    .extract({ left: halfW, top: halfH, width: w - halfW, height: h - halfH })
    .png()
    .toBuffer();

  return [toDataUrlPng(f1), toDataUrlPng(f2), toDataUrlPng(f3), toDataUrlPng(f4)];
}

export async function persistStoryboardFrames(input: {
  worldId: string;
  storyboardId: string;
  frames: [string, string, string, string];
}): Promise<[string, string, string, string]> {
  const baseDir = join(process.cwd(), "data", "frame", input.worldId, input.storyboardId);
  await mkdir(baseDir, { recursive: true });

  const urls: string[] = [];
  for (let i = 0; i < input.frames.length; i += 1) {
    const { buffer } = await dataUrlToBuffer(input.frames[i]);
    const resized = await resizeTo480pPng(buffer);
    const filename = `frame${i + 1}.png`;
    const filePath = join(baseDir, filename);
    await writeFile(filePath, resized);
    urls.push(`/data/frame/${input.worldId}/${input.storyboardId}/${filename}`);
  }

  return urls as [string, string, string, string];
}
