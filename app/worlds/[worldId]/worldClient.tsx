"use client";

import { useMemo, useState } from "react";
import { WorldCanvas } from "./worldCanvas";

export type SuggestedAction = { label: string; prompt: string };

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

  const initialClips = useMemo(() => props.initialVideoUrls, [props.initialVideoUrls]);

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

            {loading ? (
              <p className="text-xs text-white/80">Generating the next moment…</p>
            ) : (
              <p className="text-xs text-white/60">
                Click an action. The video is the world — no controls, no scrubbing.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

