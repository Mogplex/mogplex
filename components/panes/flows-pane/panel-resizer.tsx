"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  FLOW_PANEL_DEFAULT_WIDTH,
  FLOW_PANEL_MAX_WIDTH,
  FLOW_PANEL_MIN_WIDTH,
  clampFlowPanelWidth,
} from "./use-flow-chrome-state";

/** Canvas width the resizer refuses to shrink below, in px. */
const MIN_CANVAS_WIDTH = 360;
/** Width step for arrow-key resizing, in px. */
const KEYBOARD_STEP = 16;

export interface FlowPanelResizerProps {
  /** Current committed width of the docked panel, in px. */
  width: number;
  /** Commits a new width (clamped + persisted by the caller). */
  onWidthChange: (width: number) => void;
  /** The pane grid, used to cap the width so the canvas keeps usable room. */
  gridRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * Drag grip on the docked panel's left edge.
 *
 * Live drag updates are written straight to the grid's CSS custom property so
 * pointermove never re-renders the flows pane (a React state update per move
 * event drags the whole ReactFlow subtree with it). React state is only
 * reconciled on pointerup.
 */
export function FlowPanelResizer({
  width,
  onWidthChange,
  gridRef,
}: FlowPanelResizerProps) {
  const [dragging, setDragging] = useState(false);
  const dragStateRef = useRef<{ startX: number; startWidth: number; width: number } | null>(null);

  /** Upper bound that still leaves the canvas column usable. */
  const maxWidthForGrid = useCallback(() => {
    const grid = gridRef.current;
    if (!grid) return FLOW_PANEL_MAX_WIDTH;
    const sidebar = grid.firstElementChild;
    const sidebarWidth =
      sidebar instanceof HTMLElement ? sidebar.getBoundingClientRect().width : 0;
    const available = grid.getBoundingClientRect().width - sidebarWidth - MIN_CANVAS_WIDTH;
    return Math.max(FLOW_PANEL_MIN_WIDTH, Math.min(FLOW_PANEL_MAX_WIDTH, available));
  }, [gridRef]);

  const resolveWidth = useCallback(
    (next: number) => Math.min(clampFlowPanelWidth(next), maxWidthForGrid()),
    [maxWidthForGrid],
  );

  const previewWidth = useCallback(
    (next: number) => {
      gridRef.current?.style.setProperty("--flows-panel-width", `${next}px`);
    },
    [gridRef],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragStateRef.current = { startX: event.clientX, startWidth: width, width };
      setDragging(true);
      document.body.classList.add("flows-panel-resizing");
    },
    [width],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragStateRef.current;
      if (!drag) return;
      // Panel is on the right edge, so dragging left (negative delta) widens it.
      const next = resolveWidth(drag.startWidth - (event.clientX - drag.startX));
      drag.width = next;
      previewWidth(next);
    },
    [previewWidth, resolveWidth],
  );

  const endDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragStateRef.current;
      if (!drag) return;
      dragStateRef.current = null;
      setDragging(false);
      document.body.classList.remove("flows-panel-resizing");
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      // The preview value is left in place deliberately: React re-applies the
      // same custom property from state, so clearing it here would flash the
      // stylesheet fallback for a frame.
      if (drag.width !== drag.startWidth) onWidthChange(drag.width);
    },
    [onWidthChange],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const step =
        event.key === "ArrowLeft"
          ? KEYBOARD_STEP
          : event.key === "ArrowRight"
            ? -KEYBOARD_STEP
            : 0;
      if (step === 0) return;
      event.preventDefault();
      onWidthChange(resolveWidth(width + step));
    },
    [onWidthChange, resolveWidth, width],
  );

  // A drag interrupted by an unmount would otherwise strand the body class and
  // leave every cursor stuck on col-resize.
  useEffect(
    () => () => {
      document.body.classList.remove("flows-panel-resizing");
    },
    [],
  );

  return (
    <div
      data-testid="flows-panel-resizer"
      data-dragging={dragging ? "true" : "false"}
      className="flows-inspector-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize inspector panel"
      aria-valuenow={width}
      aria-valuemin={FLOW_PANEL_MIN_WIDTH}
      aria-valuemax={FLOW_PANEL_MAX_WIDTH}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={handleKeyDown}
      onDoubleClick={() => onWidthChange(resolveWidth(FLOW_PANEL_DEFAULT_WIDTH))}
    />
  );
}
