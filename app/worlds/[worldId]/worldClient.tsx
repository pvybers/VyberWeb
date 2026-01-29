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
  const activeIndex = useMemo(
    () => orderedHistory.findIndex((state) => state.id === activeStateId),
    [orderedHistory, activeStateId],
  );
  const indexById = useMemo(() => {
    const map = new Map<string, number>();
    orderedHistory.forEach((state, idx) => map.set(state.id, idx));
    return map;
  }, [orderedHistory]);
  const treeData = useMemo(() => {
    const byId = new Map(orderedHistory.map((state) => [state.id, state]));
    const childrenByParent = new Map<string, string[]>();
    orderedHistory.forEach((state) => {
      const parentId = state.parentStateId?.trim();
      if (!parentId || !byId.has(parentId)) return;
      const list = childrenByParent.get(parentId) ?? [];
      list.push(state.id);
      childrenByParent.set(parentId, list);
    });
    const roots = orderedHistory
      .filter((state) => !state.parentStateId || !byId.has(state.parentStateId))
      .map((state) => state.id);
    return { byId, childrenByParent, roots };
  }, [orderedHistory]);
  const treeLayout = useMemo(() => {
    const { childrenByParent, roots } = treeData;
    const widthById = new Map<string, number>();
    const positions = new Map<string, { x: number; y: number }>();
    const edges: Array<{ from: string; to: string }> = [];

    const measure = (id: string): number => {
      if (widthById.has(id)) return widthById.get(id)!;
      const children = childrenByParent.get(id) ?? [];
      if (children.length === 0) {
        widthById.set(id, 1);
        return 1;
      }
      const width = children.reduce((sum, child) => sum + measure(child), 0);
      widthById.set(id, Math.max(1, width));
      return widthById.get(id)!;
    };

    roots.forEach((rootId) => measure(rootId));

    let cursor = 0;
    const place = (id: string, depth: number, left: number) => {
      const width = widthById.get(id) ?? 1;
      const x = left + width / 2;
      positions.set(id, { x, y: depth });
      const children = childrenByParent.get(id) ?? [];
      let childLeft = left;
      children.forEach((childId) => {
        const childWidth = widthById.get(childId) ?? 1;
        edges.push({ from: id, to: childId });
        place(childId, depth + 1, childLeft);
        childLeft += childWidth;
      });
    };

    roots.forEach((rootId) => {
      const width = widthById.get(rootId) ?? 1;
      place(rootId, 0, cursor);
      cursor += width + 1;
    });

    return { positions, edges, widthUnits: cursor };
  }, [treeData]);
  const nodeWidth = 160;
  const nodeHeight = 62;
  const xSpacing = 190;
  const ySpacing = 110;
  const treeWidth = Math.max(320, treeLayout.widthUnits * xSpacing);
  const maxDepth = Math.max(
    0,
    ...Array.from(treeLayout.positions.values()).map((pos) => pos.y),
  );
  const treeHeight = Math.max(240, (maxDepth + 1) * ySpacing);
  const [isTreeOpen, setIsTreeOpen] = useState(false);
  const branchFocusIds = useMemo(() => {
    const { byId, childrenByParent } = treeData;
    const currentState = byId.get(activeStateId);
    if (!currentState) return [];
    const path: string[] = [];
    let cursor: WorldStateSnapshot | undefined = currentState;
    while (cursor) {
      path.unshift(cursor.id);
      const parentId = cursor.parentStateId?.trim();
      if (!parentId) break;
      const parent = byId.get(parentId);
      if (!parent) break;
      cursor = parent;
    }
    const children = childrenByParent.get(currentState.id) ?? [];
    return [...path, ...children];
  }, [activeStateId, treeData]);
  const getNodeLabel = useCallback(
    (state: WorldStateSnapshot, idx: number) => {
      if (state.id === activeStateId) return "Current moment";
      if (state.parentActionPrompt?.trim()) return state.parentActionPrompt.trim();
      if (state.sceneSummary?.trim()) return state.sceneSummary.trim();
      return `Snapshot ${idx + 1}`;
    },
    [activeStateId],
  );

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

            {!isMockMode ? (
              <div className="flex justify-end">
                {!showCustomInput ? (
                  <button
                    className="rounded-full border border-white/15 bg-black/30 px-3 py-1 text-[11px] text-white/70 transition-opacity hover:opacity-100"
                    onClick={() => setShowCustomInput(true)}
                  >
                    Custom input
                  </button>
                ) : (
                  <button
                    className="rounded-full border border-white/15 bg-black/30 px-3 py-1 text-[11px] text-white/70 transition-opacity hover:opacity-100"
                    onClick={() => setShowCustomInput(false)}
                  >
                    Hide input
                  </button>
                )}
              </div>
            ) : null}

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

      {/* Docked history mini graph */}
      <div className="pointer-events-auto absolute left-3 top-1/2 hidden -translate-y-1/2 md:block">
        <div className="group relative h-[60vh] w-44 rounded-2xl border border-white/10 bg-black/35 p-3 text-white shadow-[0_0_30px_rgba(80,40,150,0.25)] transition-colors hover:border-white/20">
          <button
            className="absolute inset-0 rounded-2xl"
            aria-label="Expand history tree"
            onClick={() => setIsTreeOpen(true)}
          />
          <div className="pointer-events-none mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/60">
            History
          </div>
          <div className="relative flex-1">
            <div className="absolute left-3 top-1 h-[calc(100%-8px)] w-px bg-white/15" />
            <div className="space-y-2 pr-2">
              {branchFocusIds.map((id) => {
                const state = treeData.byId.get(id);
                if (!state) return null;
                const isActive = id === activeStateId;
                const isChild = state.parentStateId === activeStateId;
                return (
                  <button
                    key={id}
                    onClick={() => jumpToState(state)}
                    className={`relative z-10 flex w-full items-start gap-2 rounded-lg px-2 py-1 text-left text-[11px] transition-colors ${
                      isActive
                        ? "bg-emerald-500/15 text-emerald-200"
                        : "text-white/70 hover:bg-white/5"
                    }`}
                  >
                    <span
                      className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full border ${
                        isActive
                          ? "border-emerald-200 bg-emerald-400"
                          : isChild
                            ? "border-sky-200 bg-sky-400/80"
                            : "border-white/30 bg-black/40"
                      }`}
                    />
                    <span className="line-clamp-2">
                        {getNodeLabel(state, indexById.get(state.id) ?? 0)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-2 mx-auto w-fit rounded-full border border-white/15 bg-black/60 px-2 py-0.5 text-[10px] text-white/60 opacity-0 transition-opacity group-hover:opacity-100">
            Click to expand
          </div>
        </div>
      </div>

      {/* History tree modal */}
      {isTreeOpen ? (
        <div className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-black/70 p-6">
          <div className="w-[90vw] max-w-5xl rounded-2xl border border-white/10 bg-black/85 p-5 text-white shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-white/60">
                History Tree
              </div>
              <div className="flex gap-2">
                <button
                  className="rounded-full border border-white/15 px-2 py-1 text-[10px] text-white/70 hover:bg-white/10"
                  onClick={() => setIsTreeOpen(false)}
                >
                  Close
                </button>
              </div>
            </div>

            <div className="max-h-[70vh] overflow-auto pr-1 no-scrollbar">
              <div
                className="relative"
                style={{
                  width: treeWidth,
                  height: treeHeight,
                }}
              >
                <svg
                  width={treeWidth}
                  height={treeHeight}
                  className="pointer-events-none absolute left-0 top-0"
                >
                  {treeLayout.edges.map((edge) => {
                    const from = treeLayout.positions.get(edge.from);
                    const to = treeLayout.positions.get(edge.to);
                    if (!from || !to) return null;
                    const x1 = from.x * xSpacing;
                    const y1 = from.y * ySpacing + nodeHeight;
                    const x2 = to.x * xSpacing;
                    const y2 = to.y * ySpacing;
                    const midY = (y1 + y2) / 2;
                    return (
                      <path
                        key={`${edge.from}-${edge.to}`}
                        d={`M ${x1} ${y1} C ${x1} ${midY} ${x2} ${midY} ${x2} ${y2}`}
                        stroke="rgba(255,255,255,0.35)"
                        strokeWidth="1.5"
                        fill="none"
                      />
                    );
                  })}
                </svg>

                {orderedHistory.map((state, idx) => {
                  const pos = treeLayout.positions.get(state.id);
                  if (!pos) return null;
                  const isActive = state.id === activeStateId;
                  const x = pos.x * xSpacing - nodeWidth / 2;
                  const y = pos.y * ySpacing;
                  return (
                    <button
                      key={state.id}
                      onClick={() => jumpToState(state)}
                      className={`absolute rounded-xl border px-3 py-2 text-left shadow-lg transition-colors ${
                        isActive
                          ? "border-emerald-300/60 bg-emerald-500/10"
                          : "border-white/10 bg-black/40 hover:bg-white/5"
                      }`}
                      style={{
                        width: nodeWidth,
                        height: nodeHeight,
                        left: x,
                        top: y,
                      }}
                    >
                      <div className="flex items-center justify-between text-[11px] text-white/70">
                        <span className={isActive ? "text-emerald-200" : ""}>
                      {isActive ? "Current" : `Snapshot ${idx + 1}`}
                        </span>
                        <span className="text-[10px] text-white/40">
                          {new Date(state.createdAt).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                    <div className="mt-1 line-clamp-2 text-[11px] text-white/60">
                      {getNodeLabel(state, idx)}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ) : null}
      <style jsx>{`
        .no-scrollbar {
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
        .no-scrollbar::-webkit-scrollbar {
          display: none;
        }
      `}</style>
    </div>
  );
}

