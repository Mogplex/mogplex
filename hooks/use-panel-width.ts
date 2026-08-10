"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

type UsePanelWidthOptions = {
  storageKey: string;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  /**
   * Which edge of the panel the drag handle sits on. "right" = handle on
   * the panel's right edge (left-side panel; width grows as the pointer
   * moves right). "left" = handle on the left edge (right-side panel).
   */
  handle: "left" | "right";
};

/**
 * Drag-to-resize for horizontal panels, matching the existing app sidebar /
 * sandbox rail behavior: pointer drag on an edge handle, ArrowLeft/Right
 * keyboard resizing, double-click reset, and localStorage persistence.
 */
export function usePanelWidth({
  storageKey,
  defaultWidth,
  minWidth,
  maxWidth,
  handle,
}: UsePanelWidthOptions) {
  const clamp = useCallback(
    (value: number) => Math.min(maxWidth, Math.max(minWidth, value)),
    [minWidth, maxWidth]
  );
  const [width, setWidth] = useState(defaultWidth);
  const [resizing, setResizing] = useState(false);
  const activePointerId = useRef<number | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const stored = Number(window.localStorage.getItem(storageKey));
      if (Number.isFinite(stored) && stored > 0) {
        setWidth(clamp(stored));
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [storageKey, clamp]);

  useEffect(() => {
    if (!resizing) return;

    const onPointerMove = (event: globalThis.PointerEvent) => {
      if (
        activePointerId.current !== null &&
        event.pointerId !== activePointerId.current
      ) {
        return;
      }
      const rect = panelRef.current?.getBoundingClientRect();
      const next = clamp(
        handle === "right"
          ? event.clientX - (rect?.left ?? 0)
          : (rect?.right ?? window.innerWidth) - event.clientX
      );
      setWidth(next);
      window.localStorage.setItem(storageKey, String(next));
    };
    const stopResizing = () => {
      activePointerId.current = null;
      setResizing(false);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopResizing);
    window.addEventListener("pointercancel", stopResizing);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopResizing);
      window.removeEventListener("pointercancel", stopResizing);
    };
  }, [resizing, handle, storageKey, clamp]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    activePointerId.current = event.pointerId;
    setResizing(true);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    // Right-edge handle: ArrowRight grows. Left-edge handle: ArrowLeft grows.
    const outward =
      handle === "right"
        ? event.key === "ArrowRight"
        : event.key === "ArrowLeft";
    const delta = outward ? 16 : -16;
    setWidth((current) => {
      const next = clamp(current + delta);
      window.localStorage.setItem(storageKey, String(next));
      return next;
    });
  };

  const onDoubleClick = () => {
    setWidth(defaultWidth);
    window.localStorage.setItem(storageKey, String(defaultWidth));
  };

  return {
    width,
    resizing,
    panelRef,
    resizerProps: {
      role: "separator" as const,
      "aria-orientation": "vertical" as const,
      "aria-valuemin": minWidth,
      "aria-valuemax": maxWidth,
      "aria-valuenow": Math.round(width),
      tabIndex: 0,
      onPointerDown,
      onKeyDown,
      onDoubleClick,
    },
  };
}
