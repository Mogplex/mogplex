"use client";

import {
  useEffect,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";

const initial = { phase: 0, fading: false, impl: 13, deploy: 0 };
type Snapshot = typeof initial;
type Cue = { at: number; patch: Partial<Snapshot> };

const cues: Cue[] = [
  ...[
    [1100, 1],
    [6100, 2],
    [6450, 3],
    [7200, 4],
    [8200, 5],
    [8900, 6],
    [9700, 7],
    [10100, 8],
  ].map(([at, phase]) => ({ at, patch: { phase } })),
  ...Array.from({ length: 5 }, (_, index) => ({
    at: 1100 + (index + 1) * 700,
    patch: { impl: 14 + index },
  })),
  { at: 9955, patch: { deploy: 1 } },
  ...Array.from({ length: 21 }, (_, index) => ({
    at: 10100 + (index + 1) * 255,
    patch: { deploy: index + 2 },
  })),
  { at: 17100, patch: { fading: true } },
  { at: 17480, patch: initial },
].sort((a, b) => a.at - b.at);

function createTimeline() {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    update(patch: Partial<Snapshot>) {
      snapshot = { ...snapshot, ...patch };
      for (const listener of listeners) listener();
    },
  };
}
export type LiveRunTimeline = ReturnType<typeof createTimeline>;

export function useTimelineValue<Key extends keyof Snapshot>(
  timeline: LiveRunTimeline,
  key: Key
) {
  return useSyncExternalStore(
    timeline.subscribe,
    () => timeline.get()[key],
    () => initial[key]
  );
}

export function useLiveRunTimeline(ref: RefObject<HTMLDivElement | null>) {
  const [timeline] = useState(createTimeline);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let visible = false;
    let animation: Animation | undefined;
    let index = 0;
    let disposed = false;

    const syncPlayback = () => {
      const paused = !visible || document.hidden || motion.matches;
      element.setAttribute("data-paused", String(paused));
      if (paused) animation?.pause();
      else animation?.play();
    };
    // Each finish event advances one authored cue. The browser owns elapsed
    // time and pause/resume; there is no frame loop or background interval.
    const scheduleCue = () => {
      if (disposed) return;
      const cue = cues[index];
      animation = element.animate([], {
        duration: cue.at - (index ? cues[index - 1].at : 0),
      });
      animation.onfinish = () => {
        timeline.update(cue.patch);
        index = (index + 1) % cues.length;
        scheduleCue();
      };
      syncPlayback();
    };
    const resetMotion = () => {
      animation?.cancel();
      if (motion.matches) {
        timeline.update({ phase: 8, fading: false, impl: 18, deploy: 22 });
        syncPlayback();
      } else {
        index = 0;
        timeline.update(initial);
        scheduleCue();
      }
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      syncPlayback();
    });
    observer.observe(element);
    document.addEventListener("visibilitychange", syncPlayback);
    motion.addEventListener("change", resetMotion);
    resetMotion();
    return () => {
      disposed = true;
      animation?.cancel();
      observer.disconnect();
      document.removeEventListener("visibilitychange", syncPlayback);
      motion.removeEventListener("change", resetMotion);
    };
  }, [ref, timeline]);
  return timeline;
}

export function RunSeconds({
  timeline,
  kind,
}: {
  timeline: LiveRunTimeline;
  kind: "impl" | "deploy";
}) {
  return useTimelineValue(timeline, kind);
}
