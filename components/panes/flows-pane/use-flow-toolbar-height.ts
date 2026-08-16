import { useEffect, type RefObject } from "react";

/**
 * Mirrors the canvas toolbar's measured height onto the pane grid as
 * `--flows-toolbar-height`, so the docked panel headers can lock to it and the
 * two bottom borders read as a single continuous line across the pane.
 *
 * Measured rather than hard-coded because the toolbar grows a compact name row
 * and a legacy-model banner depending on pane width and flow state.
 *
 * @param toolbarActive Whether the toolbar is currently mounted. Refs do not
 *   trigger renders, so this is what re-attaches the observer when a flow is
 *   selected or cleared.
 */
export function useFlowToolbarHeight(
  toolbarRef: RefObject<HTMLDivElement | null>,
  gridRef: RefObject<HTMLDivElement | null>,
  toolbarActive: boolean
) {
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const toolbar = toolbarRef.current;
    if (!toolbarActive || !toolbar) {
      grid.style.removeProperty("--flows-toolbar-height");
      return;
    }
    const observer = new ResizeObserver(() => {
      const height = toolbar.getBoundingClientRect().height;
      if (height > 0) {
        grid.style.setProperty("--flows-toolbar-height", `${height}px`);
      }
    });
    observer.observe(toolbar);
    return () => observer.disconnect();
  }, [gridRef, toolbarActive, toolbarRef]);
}
