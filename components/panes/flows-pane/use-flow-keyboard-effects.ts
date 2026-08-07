import { useEffect, type RefObject } from "react";
import { shouldIgnoreCanvasShortcut } from "@/lib/flows/canvas-shortcuts";
import type { Flow } from "@/lib/types";
import { isMacPrimaryModifier } from "./canvas-utils";
import type { FlowContextMenuState, FlowTab } from "./types";

export type FlowKeyboardEffectsDeps = {
  // Flow state
  selectedFlow: Flow | undefined;
  selectedRunId: string | null;
  activeFlowTab: FlowTab;
  // Context menu state
  contextMenu: FlowContextMenuState | null;
  closeContextMenu: () => void;
  contextMenuRef: RefObject<HTMLDivElement | null>;
  // Canvas ref
  canvasRef: RefObject<HTMLDivElement | null>;
  // Handlers from save/publish
  persistFlow: () => Promise<boolean>;
  undoDraft: () => void;
  redoDraft: () => void;
  // Handlers from draft mutations
  duplicateSelectedCanvasItems: () => boolean;
  copySelectedCanvasItems: () => boolean;
  cutSelectedCanvasItems: () => boolean;
  pasteCanvasItems: () => boolean;
  selectAllCanvasAgents: () => boolean;
  clearCanvasSelection: () => boolean;
  deleteSelectedCanvasItems: () => boolean;
};

/**
 * Keyboard shortcut and context menu dismiss effects for the flow canvas.
 */
export function useFlowKeyboardEffects(deps: FlowKeyboardEffectsDeps): void {
  const {
    selectedFlow,
    selectedRunId,
    activeFlowTab,
    contextMenu,
    closeContextMenu,
    contextMenuRef,
    canvasRef,
    persistFlow,
    undoDraft,
    redoDraft,
    duplicateSelectedCanvasItems,
    copySelectedCanvasItems,
    cutSelectedCanvasItems,
    pasteCanvasItems,
    selectAllCanvasAgents,
    clearCanvasSelection,
    deleteSelectedCanvasItems,
  } = deps;

  // Main keyboard shortcut effect
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!selectedFlow) return;
      if (selectedRunId) return;

      const isMac = isMacPrimaryModifier();
      const hasPrimaryModifier = isMac ? event.metaKey : event.ctrlKey;
      const key = event.key.toLowerCase();

      if (hasPrimaryModifier && key === "s") {
        event.preventDefault();
        void persistFlow();
        return;
      }

      // No menu action leaves this state set while another keyboard-owned surface is open.
      if (contextMenu && event.key === "Escape") {
        closeContextMenu();
        return;
      }

      const activeElement = document.activeElement;
      const eventElement =
        event.target instanceof Element ? event.target : null;
      if (shouldIgnoreCanvasShortcut(activeElement, eventElement, document)) {
        return;
      }

      if (contextMenu) {
        // Destructive canvas shortcuts dismiss the menu without reaching the
        // current selection. Editable fields retain their native behavior via
        // the guard above.
        if (event.key === "Delete" || event.key === "Backspace") {
          event.preventDefault();
          closeContextMenu();
        }
        return;
      }

      if (hasPrimaryModifier && !event.shiftKey && key === "z") {
        event.preventDefault();
        undoDraft();
        return;
      }

      if (
        (hasPrimaryModifier && event.shiftKey && key === "z") ||
        (!isMac && event.ctrlKey && !event.shiftKey && key === "y")
      ) {
        event.preventDefault();
        redoDraft();
        return;
      }

      if (hasPrimaryModifier && key === "d") {
        event.preventDefault();
        duplicateSelectedCanvasItems();
        return;
      }

      const canvasOwnsFocus =
        activeFlowTab === "editor" &&
        Boolean(activeElement && canvasRef.current?.contains(activeElement));
      const documentSelectionIsActive =
        window.getSelection()?.isCollapsed === false;

      if (hasPrimaryModifier && key === "c") {
        if (
          canvasOwnsFocus &&
          !documentSelectionIsActive &&
          copySelectedCanvasItems()
        ) {
          event.preventDefault();
        }
        return;
      }

      if (hasPrimaryModifier && key === "x") {
        if (
          canvasOwnsFocus &&
          !documentSelectionIsActive &&
          cutSelectedCanvasItems()
        ) {
          event.preventDefault();
        }
        return;
      }

      if (hasPrimaryModifier && key === "v") {
        if (canvasOwnsFocus && pasteCanvasItems()) {
          event.preventDefault();
        }
        return;
      }

      if (hasPrimaryModifier && key === "a") {
        event.preventDefault();
        selectAllCanvasAgents();
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        clearCanvasSelection();
        return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        deleteSelectedCanvasItems();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    clearCanvasSelection,
    closeContextMenu,
    contextMenu,
    activeFlowTab,
    copySelectedCanvasItems,
    cutSelectedCanvasItems,
    deleteSelectedCanvasItems,
    duplicateSelectedCanvasItems,
    pasteCanvasItems,
    persistFlow,
    redoDraft,
    selectAllCanvasAgents,
    selectedFlow,
    selectedRunId,
    undoDraft,
    canvasRef,
  ]);

  // Context menu dismiss on outside interaction
  useEffect(() => {
    if (!contextMenu) return;

    const handlePointerDown = (event: MouseEvent | PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (!target) return;
      if (contextMenuRef.current?.contains(target)) return;
      closeContextMenu();
    };

    const handleWindowContextMenu = (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target instanceof Node ? event.target : null;
      if (!target) return;
      if (contextMenuRef.current?.contains(target)) return;
      closeContextMenu();
    };

    const handleWindowChange = () => {
      closeContextMenu();
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("contextmenu", handleWindowContextMenu);
    // Dismissing the context menu on any window resize/scroll is inherently a
    // window-event concern; observers watch specific elements and don't apply.
    // eslint-disable-next-line github/prefer-observers
    window.addEventListener("resize", handleWindowChange);
    // eslint-disable-next-line github/prefer-observers
    window.addEventListener("scroll", handleWindowChange, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("contextmenu", handleWindowContextMenu);
      window.removeEventListener("resize", handleWindowChange);
      window.removeEventListener("scroll", handleWindowChange, true);
    };
  }, [closeContextMenu, contextMenu, contextMenuRef]);
}
