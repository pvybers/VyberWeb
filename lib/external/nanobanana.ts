import { z } from "zod";

const NanoBananaResponse = z
  .object({
    imageUrl: z.string().url().optional(),
    outputUrl: z.string().url().optional(),
    url: z.string().url().optional(),
    data: z
      .object({
        imageUrl: z.string().url().optional(),
        url: z.string().url().optional(),
      })
      .optional(),
  })
  .passthrough();

/**
 * Thin adapter for your "NanoBanana" image-edit endpoint.
 *
 * Uses:
 * - `NANOBANANA_API_URL` for the HTTP endpoint
 * - `GEMINI_API_KEY` as the auth key (NanoBanana is backed by Gemini 2.5 Flash)
 */
export async function nanoBananaGenerateFourPanel(input: {
  sourceImageUrl: string;
  prompt: string;
}): Promise<{ imageUrl: string } | null> {
  const url = process.env.NANOBANANA_API_URL?.trim();
  if (!url) return null;

  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  const key = process.env.GEMINI_API_KEY?.trim();
  if (key) headers.authorization = `Bearer ${key}`;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      // Common field names; adjust to match your endpoint.
      imageUrl: input.sourceImageUrl,
      prompt: input.prompt,
      layout: "2x2",
      panels: 4,
      // Prefer smaller 16:9-ish output (Gemini / NanoBanana may interpret these hints).
      width: 854,
      height: 480,
    }),
  });

  if (!res.ok) throw new Error(`NanoBanana failed: ${res.status} ${await res.text()}`);
  const json = await res.json().catch(() => null);
  const parsed = NanoBananaResponse.safeParse(json);
  if (!parsed.success) return null;

  const imageUrl =
    parsed.data.imageUrl ??
    parsed.data.outputUrl ??
    parsed.data.url ??
    parsed.data.data?.imageUrl ??
    parsed.data.data?.url;

  if (!imageUrl) return null;
  return { imageUrl };
}

