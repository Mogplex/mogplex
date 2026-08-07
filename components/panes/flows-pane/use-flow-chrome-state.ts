import { useEffect, useRef, useState } from "react";
import type { FlowContextMenuState } from "./types";

export type FlowChromeState = {
  // Sidebar
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  // Inspector
  inspectorCollapsed: boolean;
  setInspectorCollapsed: (collapsed: boolean) => void;
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
    contextMenu,
    setContextMenu,
    spacePanActive,
    rightSheetAnimateOpen,
    setRightSheetAnimateOpen,
  };
}
