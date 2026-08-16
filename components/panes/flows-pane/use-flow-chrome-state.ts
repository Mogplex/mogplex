import { useCallback, useEffect, useRef, useState } from "react";
import type { FlowContextMenuState } from "./types";

/** Docked panel width bounds, in px. */
export const FLOW_PANEL_MIN_WIDTH = 288;
export const FLOW_PANEL_MAX_WIDTH = 720;
export const FLOW_PANEL_DEFAULT_WIDTH = 336;

export function clampFlowPanelWidth(width: number): number {
  if (!Number.isFinite(width)) return FLOW_PANEL_DEFAULT_WIDTH;
  return Math.min(
    FLOW_PANEL_MAX_WIDTH,
    Math.max(FLOW_PANEL_MIN_WIDTH, Math.round(width))
  );
}

export type FlowChromeState = {
  // Sidebar
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  // Inspector
  inspectorCollapsed: boolean;
  setInspectorCollapsed: (collapsed: boolean) => void;
  /** Width of the docked inspector/assistant column, in px. */
  panelWidth: number;
  setPanelWidth: (width: number) => void;
  // Context menu
  contextMenu: FlowContextMenuState | null;
  setContextMenu: (menu: FlowContextMenuState | null) => void;
  // Space pan mode (Figma/tldraw-style grab panning)
  spacePanActive: boolean;
  // Right sheet animation - managed separately via effect in component
  rightSheetAnimateOpen: boolean;
  setRightSheetAnimateOpen: (open: boolean) => void;
};

/**
 * Manages chrome/UI state for the flows pane: sidebar collapse,
 * inspector collapse, context menu, and space-pan mode.
 *
 * Sidebar and inspector collapsed states are persisted to localStorage.
 * Space-pan mode is activated by holding the Space key (Figma/tldraw-style).
 *
 * Note: rightSheetAnimateOpen is returned but not automatically synced.
 * The component must run its own effect to sync it with rightSheetOpen.
 */
export function useFlowChromeState(): FlowChromeState {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [panelWidth, setPanelWidthState] = useState(FLOW_PANEL_DEFAULT_WIDTH);
  const [contextMenu, setContextMenu] = useState<FlowContextMenuState | null>(
    null
  );
  const [spacePanActive, setSpacePanActive] = useState(false);
  const [rightSheetAnimateOpen, setRightSheetAnimateOpen] = useState(false);

  // Hydrate sidebar collapsed state from localStorage
  const sidebarHydratedRef = useRef(false);
  useEffect(() => {
    const stored = window.localStorage.getItem("mplex.flows.sidebarCollapsed");
    if (stored === "true") setSidebarCollapsed(true);
    sidebarHydratedRef.current = true;
  }, []);

  // Persist sidebar collapsed state to localStorage
  useEffect(() => {
    if (!sidebarHydratedRef.current) return;
    window.localStorage.setItem(
      "mplex.flows.sidebarCollapsed",
      String(sidebarCollapsed)
    );
  }, [sidebarCollapsed]);

  // Hydrate inspector collapsed state from localStorage
  const inspectorHydratedRef = useRef(false);
  useEffect(() => {
    const stored = window.localStorage.getItem(
      "mplex.flows.inspectorCollapsed"
    );
    if (stored === "true") setInspectorCollapsed(true);
    inspectorHydratedRef.current = true;
  }, []);

  // Persist inspector collapsed state to localStorage
  useEffect(() => {
    if (!inspectorHydratedRef.current) return;
    window.localStorage.setItem(
      "mplex.flows.inspectorCollapsed",
      String(inspectorCollapsed)
    );
  }, [inspectorCollapsed]);

  // Hydrate the docked panel width. Written on drag end (not per pointermove),
  // so the write stays off the drag hot path.
  useEffect(() => {
    const stored = window.localStorage.getItem("mplex.flows.panelWidth");
    if (stored === null) return;
    const parsed = Number.parseInt(stored, 10);
    if (Number.isNaN(parsed)) return;
    setPanelWidthState(clampFlowPanelWidth(parsed));
  }, []);

  const setPanelWidth = useCallback((width: number) => {
    const clamped = clampFlowPanelWidth(width);
    setPanelWidthState(clamped);
    window.localStorage.setItem("mplex.flows.panelWidth", String(clamped));
  }, []);

  // Space key activates grab-pan mode for the canvas
  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      if (target.isContentEditable) return true;
      const tag = target.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      if (isTypingTarget(event.target)) return;
      // Stop Space from scrolling the page or activating a focused button — must
      // run on auto-repeat keydowns too, otherwise a held Space still scrolls.
      event.preventDefault();
      if (event.repeat) return;
      setSpacePanActive(true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      setSpacePanActive(false);
    };
    const reset = () => setSpacePanActive(false);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", reset);
    };
  }, []);

  return {
    sidebarCollapsed,
    setSidebarCollapsed,
    inspectorCollapsed,
    setInspectorCollapsed,
    panelWidth,
    setPanelWidth,
    contextMenu,
    setContextMenu,
    spacePanActive,
    rightSheetAnimateOpen,
    setRightSheetAnimateOpen,
  };
}
