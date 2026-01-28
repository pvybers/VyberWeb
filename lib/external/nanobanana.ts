import { GoogleGenAI } from "@google/genai";

function normalizeImageUrl(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  const base = process.env.APP_ORIGIN?.trim() || "http://127.0.0.1:3000";
  if (url.startsWith("/")) return `${base}${url}`;
  return `${base}/${url}`;
}

async function fetchImageAsInlineData(
  url: string,
): Promise<{ mimeType: string; data: string } | null> {
  try {
    if (url.startsWith("data:")) {
      const match = /^data:([^;]+);base64,(.+)$/.exec(url);
      if (!match) {
        console.warn("[nanobanana] Unsupported data URL format for source image");
        return null;
      }
      const [, mimeType, data] = match;
      return { mimeType, data };
    }

    const absoluteUrl = normalizeImageUrl(url);
    const res = await fetch(absoluteUrl);
    if (!res.ok) {
      console.warn("[nanobanana] Failed to fetch source image:", res.status, absoluteUrl);
      return null;
    }
    const contentType = res.headers.get("content-type") ?? "image/png";
    const buf = Buffer.from(await res.arrayBuffer());
    const b64 = buf.toString("base64");
    return { mimeType: contentType, data: b64 };
  } catch (err) {
    console.warn("[nanobanana] Error fetching source image", err);
    return null;
  }
}

function buildStoryboardPrompt(prompt: string): string {
  return [
    prompt.trim(),
    "",
    "Output: a single 2x2 storyboard grid image (four panels).",
    "Panels are same size, arranged left-to-right, top-to-bottom (1-4).",
    "No captions, no borders, no numbers, no text overlays.",
  ].join("\n");
}

/**
 * Gemini 3.5 Flash image generation adapter for 4-panel storyboards.
 *
 * Uses `GEMINI_API_KEY` and the Gemini image model.
 */
export async function nanoBananaGenerateFourPanel(input: {
  sourceImageUrl: string;
  prompt: string;
}): Promise<{ imageUrl: string } | null> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    console.warn("[nanobanana] Missing GEMINI_API_KEY");
    return null;
  }
  const modelName = process.env.GEMINI_IMAGE_MODEL?.trim() || "gemini-2.5-flash-image";
  const ai = new GoogleGenAI({ apiKey });

  console.log("[nanobanana] Requesting 4-panel image", {
    hasSourceImage: Boolean(input.sourceImageUrl),
    promptPreview: input.prompt.slice(0, 120),
    model: modelName,
  });

  const inlineImage = await fetchImageAsInlineData(input.sourceImageUrl);
  const parts: Array<Record<string, unknown>> = [{ text: buildStoryboardPrompt(input.prompt) }];
  if (inlineImage) {
    parts.push({ inlineData: inlineImage });
  }

  const json = (await ai.models
    .generateContent({
      model: modelName,
      contents: parts,
      config: { responseModalities: ["IMAGE"] },
    })
    .catch((e) => {
      console.error("[nanobanana] Gemini SDK error", e);
      return null;
    })) as any;
  if (!json) return null;

  if (json?.error?.message) {
    console.error("[nanobanana] Gemini error payload", json.error);
    return null;
  }

  const candidates = json?.candidates ?? json?.response?.candidates ?? [];
  const partsOut = candidates?.[0]?.content?.parts ?? [];
  const inline =
    partsOut.find((p: any) => p?.inlineData?.data) ??
    partsOut.find((p: any) => p?.inline_data?.data) ??
    null;

  const data = inline?.inlineData?.data ?? inline?.inline_data?.data;
  const mimeType = inline?.inlineData?.mimeType ?? inline?.inline_data?.mime_type ?? "image/png";

  if (!data) {
    console.error("[nanobanana] Gemini response missing inline image data", {
      candidates: candidates?.length ?? 0,
      keys: Object.keys(json ?? {}),
    });
    return null;
  }

  const imageUrl = `data:${mimeType};base64,${data}`;
  console.log("[nanobanana] Generated 4-panel image data URL", {
    mimeType,
    dataBytes: data?.length ?? 0,
  });
  return { imageUrl };
}

