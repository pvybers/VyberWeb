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

export async function suggestNextActionsWithGemini(input: {
  worldPrompt: string;
  sceneSummary: string;
  actionPrompt: string;
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
    "Generate the next 3-4 plausible actions that could happen next.",
  ].join("\n");

  const resp = await model.generateContent([
    { text: system },
    { text: user },
  ]);

  const text = resp.response.text().trim();
  const json = JSON.parse(text);
  const parsed = SuggestedActionsSchema.safeParse(json);
  if (!parsed.success) return null;
  return parsed.data;
}

