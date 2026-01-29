"use client";

import { useEffect, useRef } from "react";
import type { SuggestedAction } from "./worldClient";

type StepResponse = {
  videoUrls: string[];
  actions: SuggestedAction[];
  sceneSummary?: string;
  worldStateId?: string;
};

type StoryboardResponse = {
  storyboardId: string;
  frameUrls: string[];
};

const SWAP_AT_SECONDS = 4.8;

function waitForEvent(el: HTMLMediaElement, event: string): Promise<void> {
  return new Promise((resolve) => {
    const cleanup = (done: () => void) => {
      el.removeEventListener(event, onOk);
      el.removeEventListener("error", onErr);
      clearTimeout(timeoutId);
      done();
    };
    const onOk = () => cleanup(resolve);
    const onErr = () => cleanup(resolve);
    const timeoutId = setTimeout(() => cleanup(resolve), 10000);

    el.addEventListener(event, onOk, { once: true });
    el.addEventListener("error", onErr, { once: true });
  });
}

async function loadVideo(el: HTMLVideoElement, url: string): Promise<void> {
  let normalizedUrl = url.startsWith("/") ? url : `/${url}`;
  if (
    normalizedUrl.startsWith("/data/") &&
    !normalizedUrl.startsWith("/data/vid/") &&
    normalizedUrl.toLowerCase().endsWith(".mp4")
  ) {
    normalizedUrl = normalizedUrl.replace("/data/", "/data/vid/");
  }
  
  // Always reload if URL is different
  if (!el.src || !el.src.endsWith(normalizedUrl)) {
    el.src = normalizedUrl;
    el.load();
  }
  
  // Wait for video to be ready to play (not just loadeddata, but canplaythrough)
  if (el.readyState < 4) {
    await waitForEvent(el, "canplaythrough");
  }
}

async function ensureVideoPlaying(el: HTMLVideoElement): Promise<void> {
  if (el.paused) {
    el.currentTime = 0;
    await el.play().catch((err) => {
      console.warn("Play failed:", err);
    });
  }
  // Wait a bit for video to actually start rendering
  await new Promise((resolve) => setTimeout(resolve, 200));
}

export function WorldCanvas(props: {
  worldId: string;
  initialVideoUrls: string[];
  onActions: (actions: SuggestedAction[]) => void;
  onLoading: (loading: boolean) => void;
  onSceneSummary?: (scene: string) => void;
}) {
  const videoARef = useRef<HTMLVideoElement | null>(null);
  const videoBRef = useRef<HTMLVideoElement | null>(null);

  const worldIdRef = useRef(props.worldId);
  const onActionsRef = useRef(props.onActions);
  const onLoadingRef = useRef(props.onLoading);
  const onSceneSummaryRef = useRef(props.onSceneSummary);
  const clipSetRef = useRef<string[]>(props.initialVideoUrls);
  const clipIndexRef = useRef(0);
  const activeSlotRef = useRef<0 | 1>(0);
  const swappingRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const lastSwapTimeRef = useRef<number>(0);
  
  // Track which clip index is loaded in each slot
  const slotAClipIndexRef = useRef<number>(-1);
  const slotBClipIndexRef = useRef<number>(-1);

  const pendingClipSetRef = useRef<string[] | null>(null);

  useEffect(() => {
    worldIdRef.current = props.worldId;
    onActionsRef.current = props.onActions;
    onLoadingRef.current = props.onLoading;
    onSceneSummaryRef.current = props.onSceneSummary;
    clipSetRef.current = props.initialVideoUrls;
  }, [
    props.worldId,
    props.onActions,
    props.onLoading,
    props.onSceneSummary,
    props.initialVideoUrls,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let cancelled = false;

    void (async () => {
      if (cancelled) return;
      const a = videoARef.current;
      const b = videoBRef.current;
      if (!a || !b) return;

      // Ensure both elements are muted/autoplay-friendly.
      a.muted = true;
      b.muted = true;
      a.playsInline = true;
      b.playsInline = true;
      a.preload = "auto";
      b.preload = "auto";

      // Add error handlers for debugging
      const errorHandlerA = (e: Event) => {
        console.error("Video A error:", e, a.error, a.src);
      };
      const errorHandlerB = (e: Event) => {
        console.error("Video B error:", e, b.error, b.src);
      };
      a.addEventListener("error", errorHandlerA);
      b.addEventListener("error", errorHandlerB);

      // Add loadeddata handlers for debugging
      const loadedHandlerA = () => {
        console.log("Video A loaded:", a.src.split("/").pop(), "readyState:", a.readyState);
      };
      const loadedHandlerB = () => {
        console.log("Video B loaded:", b.src.split("/").pop(), "readyState:", b.readyState);
      };
      a.addEventListener("canplaythrough", loadedHandlerA);
      b.addEventListener("canplaythrough", loadedHandlerB);

      const boot = async () => {
        const clips = clipSetRef.current;
        if (clips.length !== 3) throw new Error("Expected exactly 3 clips");

        console.log("🚀 Booting with clips:", clips.map((c, i) => `[${i}] ${c.split("/").pop()}`));

        // Active slot = A (0), preload B (1)
        activeSlotRef.current = 0;
        clipIndexRef.current = 0;
        lastSwapTimeRef.current = Date.now();

        try {
          // Load first clip (index 0) into slot A
          console.log("📥 Loading clip 0 into slot A...");
          await loadVideo(a, clips[0]!);
          slotAClipIndexRef.current = 0;
          console.log("✓ Loaded clip 0 into slot A:", clips[0]!.split("/").pop());

          // Load second clip (index 1) into slot B
          console.log("📥 Loading clip 1 into slot B...");
          await loadVideo(b, clips[1]!);
          slotBClipIndexRef.current = 1;
          console.log("✓ Loaded clip 1 into slot B:", clips[1]!.split("/").pop());

          // Visibility: A on, B off.
          a.style.opacity = "1";
          b.style.opacity = "0";

          // Start playing A - ensure it's actually playing before continuing
          console.log("▶️ Starting clip 0...");
          a.currentTime = 0;
          await ensureVideoPlaying(a);
          console.log("✓ Started playing clip 0");
          
          // Verify initial state
          console.log(`📊 Initial state: clipIndex=${clipIndexRef.current}, activeSlot=${activeSlotRef.current}`);
          console.log(`📊 Slot A (clip ${slotAClipIndexRef.current}): ${a.src.split("/").pop()}`);
          console.log(`📊 Slot B (clip ${slotBClipIndexRef.current}): ${b.src.split("/").pop()}`);
        } catch (error) {
          console.error("❌ Error in boot:", error);
        }
      };

      void boot();

      const tick = () => {
        if (cancelled) return;
        
        const aLocal = videoARef.current;
        const bLocal = videoBRef.current;
        if (!aLocal || !bLocal) {
          rafRef.current = requestAnimationFrame(tick);
          return;
        }

        const activeSlot = activeSlotRef.current;
        const activeEl = activeSlot === 0 ? aLocal : bLocal;

        const pending = pendingClipSetRef.current;
        if (pending && !swappingRef.current) {
          // If we have a freshly generated set, swap ASAP (no waiting for 4.8s).
          void swapToNewClipSet(pending);
        } else if (
          !swappingRef.current &&
          activeEl.readyState >= 4 &&
          activeEl.currentTime > 0
        ) {
          // Check if we should swap: at 4.8s or if video ended
          const timeSinceLastSwap = Date.now() - lastSwapTimeRef.current;
          const shouldSwap = 
            (activeEl.currentTime >= SWAP_AT_SECONDS && timeSinceLastSwap > 500) ||
            (activeEl.ended && activeEl.duration > 0);
          
          if (shouldSwap) {
            void swapToNextClip();
          }
        }

        rafRef.current = requestAnimationFrame(tick);
      };

      rafRef.current = requestAnimationFrame(tick);

      const onAction = (e: Event) => {
        const detail = (e as CustomEvent).detail as { prompt?: string };
        const prompt = detail?.prompt?.trim();
        if (!prompt) return;
        void requestStoryboard(prompt);
      };

      window.addEventListener("vyber:action", onAction as EventListener);

      const onGenerateVideo = (e: Event) => {
        const detail = (e as CustomEvent).detail as {
          storyboardId?: string;
          actionPrompt?: string;
        };
        const storyboardId = detail?.storyboardId?.trim();
        const actionPrompt = detail?.actionPrompt?.trim();
        if (!storyboardId || !actionPrompt) return;
        void generateVideo(actionPrompt, storyboardId);
      };

      window.addEventListener("vyber:generateVideo", onGenerateVideo as EventListener);

      const onJumpState = (e: Event) => {
        const detail = (e as CustomEvent).detail as { videoUrls?: string[] };
        if (!detail?.videoUrls || detail.videoUrls.length !== 3) return;
        pendingClipSetRef.current = detail.videoUrls;
      };

      window.addEventListener("vyber:jumpState", onJumpState as EventListener);

      const cleanup = () => {
        window.removeEventListener("vyber:action", onAction as EventListener);
        window.removeEventListener("vyber:generateVideo", onGenerateVideo as EventListener);
        window.removeEventListener("vyber:jumpState", onJumpState as EventListener);
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        
        // Remove event listeners
        if (a) {
          a.removeEventListener("error", errorHandlerA);
          a.removeEventListener("canplaythrough", loadedHandlerA);
        }
        if (b) {
          b.removeEventListener("error", errorHandlerB);
          b.removeEventListener("canplaythrough", loadedHandlerB);
        }
      };

      // Store cleanup on ref so outer return can call it.
      (worldIdRef as unknown as { cleanup?: () => void }).cleanup = cleanup;
    })();

    return () => {
      cancelled = true;
      const anyRef = worldIdRef as unknown as { cleanup?: () => void };
      anyRef.cleanup?.();
    };

    async function swapToNextClip() {
      if (swappingRef.current) {
        console.log("⚠ Swap already in progress, skipping");
        return;
      }
      swappingRef.current = true;
      lastSwapTimeRef.current = Date.now();

      try {
        const clips = clipSetRef.current;
        const currentClipIndex = clipIndexRef.current;
        const nextClipIndex = (currentClipIndex + 1) % clips.length;
        const nextNextClipIndex = (nextClipIndex + 1) % clips.length;

        console.log(`🔄 Swapping: clip ${currentClipIndex} -> clip ${nextClipIndex} -> clip ${nextNextClipIndex}`);
        console.log(`📊 Before swap: activeSlot=${activeSlotRef.current}, clipIndex=${clipIndexRef.current}`);

        const aLocal = videoARef.current;
        const bLocal = videoBRef.current;
        if (!aLocal || !bLocal) {
          swappingRef.current = false;
          return;
        }

        const activeSlot = activeSlotRef.current;
        const standbySlot: 0 | 1 = activeSlot === 0 ? 1 : 0;

        const activeEl = activeSlot === 0 ? aLocal : bLocal;
        const standbyEl = standbySlot === 0 ? aLocal : bLocal;
        
        console.log(`📊 Active slot ${activeSlot} (clip ${activeSlot === 0 ? slotAClipIndexRef.current : slotBClipIndexRef.current}): ${activeEl.src.split("/").pop()}`);
        console.log(`📊 Standby slot ${standbySlot} (clip ${standbySlot === 0 ? slotAClipIndexRef.current : slotBClipIndexRef.current}): ${standbyEl.src.split("/").pop()}`);

        // Verify standby has the correct clip, reload if needed
        const expectedUrl = clips[nextClipIndex]!;
        const standbyCurrentClipIndex = standbySlot === 0 ? slotAClipIndexRef.current : slotBClipIndexRef.current;
        
        if (standbyCurrentClipIndex !== nextClipIndex) {
          console.log(`⚠ Standby slot ${standbySlot} has clip ${standbyCurrentClipIndex} but needs clip ${nextClipIndex}, loading...`);
          await loadVideo(standbyEl, expectedUrl);
          if (standbySlot === 0) {
            slotAClipIndexRef.current = nextClipIndex;
          } else {
            slotBClipIndexRef.current = nextClipIndex;
          }
          console.log(`✓ Loaded clip ${nextClipIndex} into standby slot ${standbySlot}`);
        } else {
          console.log(`✓ Standby slot ${standbySlot} already has correct clip ${nextClipIndex}`);
        }

        // CRITICAL: Ensure standby video is fully ready and playing BEFORE swapping visibility
        console.log("⏳ Ensuring standby video is ready...");
        if (standbyEl.readyState < 4) {
          await waitForEvent(standbyEl, "canplaythrough");
        }
        
        // Reset and start playing standby BEFORE swap
        console.log("▶️ Starting standby video...");
        standbyEl.currentTime = 0;
        await ensureVideoPlaying(standbyEl);
        console.log("✓ Standby video is playing");

        // NOW swap visibility (standby is already playing and rendering)
        console.log("👁️ Swapping visibility...");
        standbyEl.style.opacity = "1";
        activeEl.style.opacity = "0";
        console.log(`✓ Swapped visibility: slot ${standbySlot} now visible`);

        // Pause and reset the old one
        activeEl.pause();
        activeEl.currentTime = 0;

        // Update state
        activeSlotRef.current = standbySlot;
        clipIndexRef.current = nextClipIndex;

        // Preload the clip after next into the now-standby slot
        const newStandbySlot: 0 | 1 = standbySlot === 0 ? 1 : 0;
        const newStandbyEl = newStandbySlot === 0 ? aLocal : bLocal;
        const nextNextUrl = clips[nextNextClipIndex]!;
        console.log(`⏭ Preloading clip ${nextNextClipIndex} into slot ${newStandbySlot}...`);
        await loadVideo(newStandbyEl, nextNextUrl);
        if (newStandbySlot === 0) {
          slotAClipIndexRef.current = nextNextClipIndex;
        } else {
          slotBClipIndexRef.current = nextNextClipIndex;
        }
        console.log(`✓ Preloaded clip ${nextNextClipIndex} into slot ${newStandbySlot}`);

        console.log(`✅ Swap complete: now playing clip ${nextClipIndex} in slot ${standbySlot}`);
        console.log(`📊 Slot A (clip ${slotAClipIndexRef.current}): ${aLocal.src.split("/").pop()}`);
        console.log(`📊 Slot B (clip ${slotBClipIndexRef.current}): ${bLocal.src.split("/").pop()}`);
      } catch (error) {
        console.error("❌ Error in swapToNextClip:", error);
      } finally {
        swappingRef.current = false;
      }
    }

    async function swapToNewClipSet(newClips: string[]) {
      if (newClips.length !== 3) {
        console.error("❌ Invalid clip set length:", newClips.length);
        return;
      }
      if (swappingRef.current) {
        console.log("⚠ Swap already in progress, queuing new clip set");
        pendingClipSetRef.current = newClips;
        return;
      }
      
      swappingRef.current = true;
      lastSwapTimeRef.current = Date.now();

      console.log("🎬 Swapping to new clip set:", newClips.map((c, i) => `[${i}] ${c.split("/").pop()}`));

      const aLocal = videoARef.current;
      const bLocal = videoBRef.current;
      if (!aLocal || !bLocal) {
        swappingRef.current = false;
        return;
      }

      const activeSlot = activeSlotRef.current;
      const standbySlot: 0 | 1 = activeSlot === 0 ? 1 : 0;

      const activeEl = activeSlot === 0 ? aLocal : bLocal;
      const standbyEl = standbySlot === 0 ? aLocal : bLocal;

      // Load the first clip of the new set into standby
      await loadVideo(standbyEl, newClips[0]!);
      standbyEl.currentTime = 0;
      
      // Start playing before swap
      await ensureVideoPlaying(standbyEl);

      // Swap visibility
      standbyEl.style.opacity = "1";
      activeEl.style.opacity = "0";
      activeEl.pause();
      activeEl.currentTime = 0;

      // Update state
      clipSetRef.current = newClips;
      clipIndexRef.current = 0;
      activeSlotRef.current = standbySlot;
      
      // Update slot tracking
      if (standbySlot === 0) {
        slotAClipIndexRef.current = 0;
      } else {
        slotBClipIndexRef.current = 0;
      }

      // Preload clip 2 in the other slot
      const newStandbySlot: 0 | 1 = standbySlot === 0 ? 1 : 0;
      const newStandbyEl = newStandbySlot === 0 ? aLocal : bLocal;
      await loadVideo(newStandbyEl, newClips[1]!);
      if (newStandbySlot === 0) {
        slotAClipIndexRef.current = 1;
      } else {
        slotBClipIndexRef.current = 1;
      }

      pendingClipSetRef.current = null;
      swappingRef.current = false;
      
      console.log("✅ New clip set loaded and playing");
    }

    async function requestStoryboard(actionPrompt: string) {
      onLoadingRef.current(true);
      try {
        const res = await fetch(`/api/worlds/${worldIdRef.current}/storyboard`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ actionPrompt }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          const message = `Storyboard failed: ${res.status} ${text}`;
          window.dispatchEvent(
            new CustomEvent("vyber:stepError", {
              detail: { status: res.status, body: text, message },
            }),
          );
          throw new Error(message);
        }
        const json = (await res.json()) as StoryboardResponse;
        window.dispatchEvent(
          new CustomEvent("vyber:storyboardReady", {
            detail: {
              storyboardId: json.storyboardId,
              frameUrls: json.frameUrls,
              actionPrompt,
            },
          }),
        );
      } catch (error) {
        console.error("❌ Error in requestStoryboard:", error);
      } finally {
        onLoadingRef.current(false);
      }
    }

    async function generateVideo(actionPrompt: string, storyboardId: string) {
      onLoadingRef.current(true);
      try {
        const res = await fetch(`/api/worlds/${worldIdRef.current}/step`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ actionPrompt, storyboardId }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          const message = `Step failed: ${res.status} ${text}`;
          window.dispatchEvent(
            new CustomEvent("vyber:stepError", {
              detail: { status: res.status, body: text, message },
            }),
          );
          throw new Error(message);
        }
        const json = (await res.json()) as StepResponse;
        onActionsRef.current(json.actions ?? []);
        if (json.sceneSummary && onSceneSummaryRef.current) {
          onSceneSummaryRef.current(json.sceneSummary);
        }

        // Begin preloading by setting pending set; the RAF loop will swap ASAP.
        pendingClipSetRef.current = json.videoUrls;
        if (json.worldStateId) {
          window.dispatchEvent(
            new CustomEvent("vyber:stateCreated", {
              detail: { worldStateId: json.worldStateId },
            }),
          );
        }
        console.log("📥 Received new video URLs, will swap when ready");
      } catch (error) {
        console.error("❌ Error in generateVideo:", error);
      } finally {
        onLoadingRef.current(false);
      }
    }
  }, []);

  return (
    <div className="pointer-events-none absolute inset-0">
      {/* Slot A */}
      <div className="absolute inset-0 transition-opacity duration-75">
        <video
          ref={videoARef}
          className="h-full w-full object-cover transition-opacity duration-75"
          playsInline
          muted
          preload="auto"
          loop={false}
        />
      </div>

      {/* Slot B */}
      <div className="absolute inset-0 transition-opacity duration-75">
        <video
          ref={videoBRef}
          className="h-full w-full object-cover transition-opacity duration-75"
          playsInline
          muted
          preload="auto"
          loop={false}
        />
      </div>
    </div>
  );
}
