/**
 * React Flow's `MiniMap` derives its internal view scale from the `width` and
 * `height` it is handed (200x150 when omitted), not from the measured DOM box.
 * Resizing the element in CSS alone therefore desyncs `pannable` drags: the
 * pan handler converts pointer deltas through `boundingRect.width / 200`, so a
 * minimap CSS-shrunk to 140px moves the canvas at roughly 70% of the cursor.
 *
 * Sizing it here instead lets us pass the same numbers to the component, which
 * keeps the rendered box and React Flow's math in agreement.
 */

/** Never smaller than this, or the node dots stop being legible. */
const MIN_WIDTH = 120;
/** React Flow's own default, which looks oversized past ~1800px canvases. */
const MAX_WIDTH = 220;
/** Matches the 200x150 default, so the mask keeps its familiar proportions. */
const ASPECT_RATIO = 4 / 3;
/** Share of the canvas the minimap may claim on each axis. */
const WIDTH_FRACTION = 0.13;
const HEIGHT_FRACTION = 0.22;

export type MinimapSize = { width: number; height: number };

/**
 * Size the minimap from the canvas it overlays rather than the window, so a
 * docked inspector shrinking the canvas shrinks the minimap with it.
 *
 * The height fraction is the binding constraint on short viewports, which is
 * what stops the minimap from overhanging the canvas and colliding with the
 * execution log.
 */
export function getMinimapSize(
  canvasWidth: number,
  canvasHeight: number
): MinimapSize {
  const fromCanvas = Math.min(
    canvasWidth * WIDTH_FRACTION,
    canvasHeight * HEIGHT_FRACTION
  );
  // Canvas dimensions are 0 until React Flow measures itself on first paint.
  const bounded = Number.isFinite(fromCanvas) ? fromCanvas : MIN_WIDTH;
  const width = Math.min(Math.max(bounded, MIN_WIDTH), MAX_WIDTH);
  return { width: Math.round(width), height: Math.round(width / ASPECT_RATIO) };
}
