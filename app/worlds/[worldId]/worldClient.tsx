"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WorldCanvas } from "./worldCanvas";

export type SuggestedAction = { label: string; prompt: string };
type StoryboardPreview = {
  storyboardId: string;
  frameUrls: string[];
  actionPrompt: string;
};

type WorldStateSnapshot = {
  id: string;
  createdAt: string;
  sceneSummary: string;
  videoUrls: string[];
  actions: SuggestedAction[];
  parentStateId?: string | null;
  parentActionPrompt?: string | null;
};

export function WorldClient(props: {
  worldId: string;
  initialStateId: string;
  initialSceneSummary: string;
  initialVideoUrls: string[];
  initialActions: SuggestedAction[];
}) {
  const [actions, setActions] = useState<SuggestedAction[]>([]);
  const [loading, setLoading] = useState(false);
  const [custom, setCustom] = useState("");
  const [sceneSummary, setSceneSummary] = useState(props.initialSceneSummary);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<WorldStateSnapshot[]>([]);
  const [activeStateId, setActiveStateId] = useState<string>(props.initialStateId);
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [showCustomToggle, setShowCustomToggle] = useState(false);
  const isMockMode = process.env.NEXT_PUBLIC_MOCK_MODE === "true";

  const actionsTimerRef = useRef<number | null>(null);

  const initialClips = useMemo(() => props.initialVideoUrls, [props.initialVideoUrls]);

  const scheduleActions = useCallback((next: SuggestedAction[]) => {
    if (actionsTimerRef.current) {
      window.clearTimeout(actionsTimerRef.current);
    }
    setActions([]);
    actionsTimerRef.current = window.setTimeout(() => {
      setActions(next);
    }, 5000);
  }, []);

  const refreshHistory = useCallback(async () => {
    try {
      const res = await fetch(`/api/worlds/${props.worldId}/states`);
      if (!res.ok) return;
      const json = (await res.json()) as { states?: WorldStateSnapshot[] };
      const states = (json.states ?? []).map((state) => ({
        ...state,
        createdAt: new Date(state.createdAt).toISOString(),
      }));
      setHistory(states);
      if (!states.find((state) => state.id === activeStateId) && states.length > 0) {
        setActiveStateId(states[states.length - 1]!.id);
      }
    } catch (err) {
      console.warn("Failed to load world history", err);
    }
  }, [props.worldId, activeStateId]);

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
      window.dispatchEvent(
        new CustomEvent("vyber:generateVideo", {
          detail: {
            storyboardId: detail.storyboardId,
            actionPrompt: detail.actionPrompt,
          },
        }),
      );
    };
    window.addEventListener("vyber:storyboardReady", onStoryboardReady as EventListener);
    return () =>
      window.removeEventListener("vyber:storyboardReady", onStoryboardReady as EventListener);
  }, []);

  useEffect(() => {
    scheduleActions(props.initialActions);
  }, [props.initialActions, scheduleActions]);

  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

  useEffect(() => {
    const timer = window.setTimeout(() => setShowCustomToggle(true), 250);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const onStateCreated = (e: Event) => {
      const detail = (e as CustomEvent).detail as { worldStateId?: string } | undefined;
      if (detail?.worldStateId) {
        setActiveStateId(detail.worldStateId);
      }
      void refreshHistory();
    };
    window.addEventListener("vyber:stateCreated", onStateCreated as EventListener);
    return () => window.removeEventListener("vyber:stateCreated", onStateCreated as EventListener);
  }, [refreshHistory]);

  const jumpToState = useCallback(
    (state: WorldStateSnapshot) => {
      setActiveStateId(state.id);
      setSceneSummary(state.sceneSummary);
      scheduleActions(state.actions);
      setError(null);
      setLoading(false);
      window.dispatchEvent(
        new CustomEvent("vyber:jumpState", { detail: { videoUrls: state.videoUrls } }),
      );
    },
    [scheduleActions],
  );

  const orderedHistory = useMemo(() => history, [history]);
  const laneById = useMemo(() => {
    const byId = new Map(orderedHistory.map((state) => [state.id, state]));
    const childrenByParent = new Map<string, WorldStateSnapshot[]>();
    orderedHistory.forEach((state) => {
      if (!state.parentStateId) return;
      const list = childrenByParent.get(state.parentStateId) ?? [];
      list.push(state);
      childrenByParent.set(state.parentStateId, list);
    });
    const laneMap = new Map<string, number>();
    const nextLane = { value: 0 };

    const assignLane = (state: WorldStateSnapshot) => {
      if (laneMap.has(state.id)) return;
      if (!state.parentStateId) {
        laneMap.set(state.id, nextLane.value++);
        return;
      }
      const parentLane = laneMap.get(state.parentStateId);
      if (parentLane === undefined) {
        const parent = byId.get(state.parentStateId);
        if (parent) assignLane(parent);
      }
      const siblings = childrenByParent.get(state.parentStateId) ?? [];
      if (siblings[0]?.id === state.id) {
        laneMap.set(state.id, laneMap.get(state.parentStateId!) ?? nextLane.value++);
      } else {
        laneMap.set(state.id, nextLane.value++);
      }
    };

    orderedHistory.forEach(assignLane);
    return laneMap;
  }, [orderedHistory]);
  const activeIndex = useMemo(
    () => orderedHistory.findIndex((state) => state.id === activeStateId),
    [orderedHistory, activeStateId],
  );
  const indexById = useMemo(() => {
    const map = new Map<string, number>();
    orderedHistory.forEach((state, idx) => map.set(state.id, idx));
    return map;
  }, [orderedHistory]);
  const rowHeight = 38;
  const branchColors = ["#22d3ee", "#a78bfa", "#34d399", "#f97316", "#f43f5e", "#facc15"];

  return (
    <div className="relative flex h-dvh w-dvw items-center justify-center bg-black">
      <div className="relative aspect-video h-full max-h-full w-full max-w-full overflow-hidden">
        <WorldCanvas
          worldId={props.worldId}
          currentStateId={activeStateId}
          initialVideoUrls={initialClips}
          onActions={scheduleActions}
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
                    if (isMockMode) {
                      const next =
                        orderedHistory.find(
                          (state) =>
                            state.parentStateId === activeStateId &&
                            state.parentActionPrompt === a.prompt,
                        ) ??
                        orderedHistory.find((state) => state.parentStateId === activeStateId);
                      if (next) jumpToState(next);
                      return;
                    }
                    window.dispatchEvent(
                      new CustomEvent("vyber:action", { detail: { prompt: a.prompt } }),
                    );
                  }}
                >
                  {a.label}
                </button>
              ))}
            </div>

            {showCustomInput && !isMockMode ? (
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
                  disabled={loading || isMockMode}
                  onChange={(e) => setCustom(e.target.value)}
                  placeholder="Type a custom action…"
                  className="w-full rounded-xl bg-white/10 px-4 py-3 text-sm text-white placeholder:text-white/60 outline-none ring-1 ring-white/10 focus:ring-white/25 disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={loading || isMockMode}
                  className="shrink-0 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-black disabled:opacity-50"
                >
                  Go
                </button>
              </form>
            ) : null}

            {error ? (
              <p className="text-xs text-red-300">
                {error}
              </p>
            ) : loading ? (
              <p className="text-xs text-white/80">Generating the next moment…</p>
            ) : (
              <p className="text-xs text-white/60">
                {actions.length === 0
                  ? "New prompts arrive in 5 seconds..."
                  : "Click an action to generate the next video."}
              </p>
            )}
          </div>
        </div>
      </div>

      {!isMockMode ? (
        !showCustomInput ? (
          <button
            className={`pointer-events-auto absolute right-6 top-6 rounded-full border border-white/15 bg-black/40 px-3 py-1 text-[11px] text-white/70 transition-opacity hover:opacity-100 ${
              showCustomToggle ? "opacity-60" : "opacity-0"
            }`}
            onClick={() => setShowCustomInput(true)}
          >
            Custom input
          </button>
        ) : (
          <button
            className="pointer-events-auto absolute right-6 top-6 rounded-full border border-white/15 bg-black/40 px-3 py-1 text-[11px] text-white/70 opacity-70 transition-opacity hover:opacity-100"
            onClick={() => setShowCustomInput(false)}
          >
            Hide input
          </button>
        )
      ) : null}

      {/* Time travel panel */}
      <div className="pointer-events-auto absolute left-5 top-1/2 hidden -translate-y-1/2 md:block">
        <div className="w-64 rounded-2xl border border-white/10 bg-black/35 p-4 text-white backdrop-blur-md shadow-[0_0_30px_rgba(80,40,150,0.25)]">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-white/60">
              Timeline
            </div>
            <div className="flex gap-2">
              <button
                disabled={loading || activeIndex <= 0}
                className="rounded-full border border-white/15 px-2 py-1 text-[10px] text-white/70 hover:bg-white/10 disabled:opacity-40"
                onClick={() => {
                  const prev = orderedHistory[activeIndex - 1];
                  if (prev) jumpToState(prev);
                }}
              >
                Back
              </button>
              <button
                disabled={loading || activeIndex < 0 || activeIndex >= orderedHistory.length - 1}
                className="rounded-full border border-white/15 px-2 py-1 text-[10px] text-white/70 hover:bg-white/10 disabled:opacity-40"
                onClick={() => {
                  const next = orderedHistory[activeIndex + 1];
                  if (next) jumpToState(next);
                }}
              >
                Forward
              </button>
            </div>
          </div>

          <div className="max-h-[60vh] space-y-1 overflow-y-auto pr-1">
            {orderedHistory.map((state, idx) => {
              const isActive = state.id === activeStateId;
              const lane = laneById.get(state.id) ?? 0;
              const parentIdx = state.parentStateId
                ? indexById.get(state.parentStateId)
                : undefined;
              const branchColor = branchColors[lane % branchColors.length];
              const indent = Math.min(lane * 8, 24);
              return (
                <button
                  key={state.id}
                  onClick={() => jumpToState(state)}
                  className="group flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-white/5"
                  style={{ minHeight: rowHeight, marginLeft: indent }}
                >
                  <span
                    className="h-10 w-1 shrink-0 rounded-full"
                    style={{ backgroundColor: branchColor }}
                  />
                  <div className="flex-1">
                    <div className="flex items-center justify-between text-xs text-white/70">
                      <span className={isActive ? "text-emerald-200" : ""}>
                        {isActive ? "Current Moment" : `Snapshot ${idx + 1}`}
                      </span>
                      <span className="text-[10px] text-white/40">
                        {new Date(state.createdAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    <div className="mt-1 line-clamp-2 text-[11px] text-white/55 group-hover:text-white/75">
                      {state.sceneSummary}
                    </div>
                    <div className="mt-1 text-[10px] text-white/40">
                      {parentIdx !== undefined ? `↳ from Snapshot ${parentIdx + 1}` : "Root"}
                      {state.parentActionPrompt
                        ? ` • "${state.parentActionPrompt.slice(0, 60)}"`
                        : ""}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

