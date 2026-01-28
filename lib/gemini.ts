import { GoogleGenerativeAI } from "@google/generative-ai";
import { z } from "zod";

const SuggestedActionsSchema = z
  .array(
    z.object({
      label: z.string().min(1).max(40),
      prompt: z.string().min(1).max(500),
    }),
  )
  .min(3)
  .max(4);

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
    // If we already have a data URL, parse it directly instead of re-fetching.
    if (url.startsWith("data:")) {
      const match = /^data:([^;]+);base64,(.+)$/.exec(url);
      if (!match) {
        console.warn("[gemini] Unsupported data URL format for last frame image");
        return null;
      }
      const [, mimeType, data] = match;
      return { mimeType, data };
    }

    const absoluteUrl = normalizeImageUrl(url);
    const res = await fetch(absoluteUrl);
    if (!res.ok) {
      console.warn("[gemini] Failed to fetch last frame image:", res.status, absoluteUrl);
      return null;
    }
    const contentType = res.headers.get("content-type") ?? "image/png";
    const buf = Buffer.from(await res.arrayBuffer());
    const b64 = buf.toString("base64");
    return { mimeType: contentType, data: b64 };
  } catch (err) {
    console.warn("[gemini] Error fetching last frame image", err);
    return null;
  }
}

export async function suggestNextActionsWithGemini(input: {
  worldPrompt: string;
  sceneSummary: string;
  actionPrompt: string;
  lastFrameUrl?: string;
}): Promise<{ label: string; prompt: string }[] | null> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;

  const modelName = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: modelName });

  const system = [
    "You are generating suggested next actions for an interactive cinematic video world.",
    "Return STRICT JSON only (no markdown, no backticks).",
    'Return an array of 3-4 objects: [{ "label": string, "prompt": string }].',
    "Labels must be short UI button text (<= 3 words). Prompts are detailed, cinematic, and actionable.",
    "Do not mention cameras, prompts, models, or the player UI.",
  ].join("\n");

  const user = [
    "WORLD PROMPT:",
    input.worldPrompt.trim(),
    "",
    "CURRENT SCENE:",
    input.sceneSummary.trim(),
    "",
    "LAST USER ACTION:",
    input.actionPrompt.trim(),
    "",
    "You are also given the most recent visual frame from the world.",
    "Use the visual details in that frame to keep actions tightly grounded in what is actually on screen.",
    "",
    "Generate the next 3-4 plausible actions that could happen next.",
  ].join("\n");

  let inlineImage: { mimeType: string; data: string } | null = null;
  if (input.lastFrameUrl) {
    inlineImage = await fetchImageAsInlineData(input.lastFrameUrl);
  }

  const parts = [
    { text: system },
    { text: user },
    ...(inlineImage ? [{ inlineData: inlineImage }] : []),
  ];

  console.log("[gemini] Requesting next actions", {
    hasImage: Boolean(inlineImage),
    model: modelName,
  });

  const resp = await model.generateContent(parts as any);

  const text = resp.response.text().trim();
  const json = JSON.parse(text);
  const parsed = SuggestedActionsSchema.safeParse(json);
  if (!parsed.success) return null;
  return parsed.data;
}

