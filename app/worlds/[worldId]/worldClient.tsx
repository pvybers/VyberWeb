"use client";

import { useEffect, useMemo, useState } from "react";
import { WorldCanvas } from "./worldCanvas";

export type SuggestedAction = { label: string; prompt: string };
type StoryboardPreview = {
  storyboardId: string;
  frameUrls: string[];
  actionPrompt: string;
};

export function WorldClient(props: {
  worldId: string;
  initialSceneSummary: string;
  initialVideoUrls: string[];
  initialActions: SuggestedAction[];
}) {
  const [actions, setActions] = useState<SuggestedAction[]>(props.initialActions);
  const [loading, setLoading] = useState(false);
  const [custom, setCustom] = useState("");
  const [sceneSummary, setSceneSummary] = useState(props.initialSceneSummary);
  const [error, setError] = useState<string | null>(null);
  const [storyboard, setStoryboard] = useState<StoryboardPreview | null>(null);

  const initialClips = useMemo(() => props.initialVideoUrls, [props.initialVideoUrls]);

  useEffect(() => {
    const onStepError = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { status?: number; body?: string; message?: string }
        | undefined;
      const msg =
        detail?.message ||
        (detail?.status
          ? `Generation failed (${detail.status}). Please try a different action.`
          : "Generation failed. Please try a different action.");
      setError(msg);
    };
    window.addEventListener("vyber:stepError", onStepError as EventListener);
    return () => window.removeEventListener("vyber:stepError", onStepError as EventListener);
  }, []);

  useEffect(() => {
    const onStoryboardReady = (e: Event) => {
      const detail = (e as CustomEvent).detail as StoryboardPreview | undefined;
      if (!detail?.storyboardId || !detail?.frameUrls?.length) return;
      setStoryboard(detail);
    };
    window.addEventListener("vyber:storyboardReady", onStoryboardReady as EventListener);
    return () =>
      window.removeEventListener("vyber:storyboardReady", onStoryboardReady as EventListener);
  }, []);

  return (
    <div className="relative flex h-dvh w-dvw items-center justify-center bg-black">
      <div className="relative aspect-video h-full max-h-full w-full max-w-full overflow-hidden">
        <WorldCanvas
          worldId={props.worldId}
          initialVideoUrls={initialClips}
          onActions={setActions}
          onLoading={setLoading}
          onSceneSummary={setSceneSummary}
        />
      </div>

      {/* Overlay UI */}
      <div className="pointer-events-none absolute inset-0">
        {/* Scene hint (Gemini-backed summary text) */}
        <div className="pointer-events-none absolute left-0 right-0 top-0 flex justify-center p-4">
          <div className="max-w-3xl rounded-xl bg-black/35 px-4 py-2 text-xs text-white/80 backdrop-blur-md">
            {sceneSummary}
          </div>
        </div>

        <div className="pointer-events-auto absolute bottom-0 left-0 right-0 p-5">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 rounded-2xl bg-black/35 p-4 backdrop-blur-md">
            <div className="flex flex-wrap gap-2">
              {actions.map((a) => (
                <button
                  key={a.label}
                  disabled={loading}
                  className="rounded-full bg-white/10 px-4 py-2 text-sm font-medium text-white hover:bg-white/15 disabled:opacity-50"
                  onClick={() => {
                    // WorldCanvas owns the request; we just expose the prompt via a custom event.
                    window.dispatchEvent(
                      new CustomEvent("vyber:action", { detail: { prompt: a.prompt } }),
                    );
                  }}
                >
                  {a.label}
                </button>
              ))}
            </div>

            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const prompt = custom.trim();
                if (!prompt) return;
                window.dispatchEvent(
                  new CustomEvent("vyber:action", { detail: { prompt } }),
                );
                setCustom("");
              }}
            >
              <input
                value={custom}
                disabled={loading}
                onChange={(e) => setCustom(e.target.value)}
                placeholder="Or type a custom action…"
                className="w-full rounded-xl bg-white/10 px-4 py-3 text-sm text-white placeholder:text-white/60 outline-none ring-1 ring-white/10 focus:ring-white/25 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={loading}
                className="shrink-0 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-black disabled:opacity-50"
              >
                Go
              </button>
            </form>

            {error ? (
              <p className="text-xs text-red-300">
                {error}
              </p>
            ) : loading ? (
              <p className="text-xs text-white/80">Generating the next moment…</p>
            ) : (
              <p className="text-xs text-white/60">
                Click an action to preview a storyboard before generating video.
              </p>
            )}
          </div>
        </div>
      </div>

      {storyboard ? (
        <div className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-black/70 p-6">
          <div className="w-full max-w-3xl rounded-2xl bg-black/85 p-6 text-white shadow-xl ring-1 ring-white/10">
            <div className="mb-4 text-sm text-white/80">Storyboard preview</div>
            <div className="grid grid-cols-2 gap-3">
              {storyboard.frameUrls.map((url, idx) => (
                <div key={url} className="overflow-hidden rounded-lg bg-black/30">
                  <img
                    src={url}
                    alt={`Storyboard frame ${idx + 1}`}
                    className="h-full w-full object-cover"
                  />
                </div>
              ))}
            </div>
            <div className="mt-4 flex items-center justify-between gap-4">
              <p className="text-xs text-white/60">
                Generate video from this storyboard?
              </p>
              <div className="flex gap-2">
                <button
                  disabled={loading}
                  className="rounded-full border border-white/20 px-4 py-2 text-sm text-white/80 hover:bg-white/10 disabled:opacity-50"
                  onClick={() => setStoryboard(null)}
                >
                  Discard
                </button>
                <button
                  disabled={loading}
                  className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
                  onClick={() => {
                    window.dispatchEvent(
                      new CustomEvent("vyber:generateVideo", {
                        detail: {
                          storyboardId: storyboard.storyboardId,
                          actionPrompt: storyboard.actionPrompt,
                        },
                      }),
                    );
                    setStoryboard(null);
                  }}
                >
                  Generate video
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

