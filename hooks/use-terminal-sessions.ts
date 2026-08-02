"use client";

import { create } from "zustand";

export type TerminalBinding = {
  sandboxId?: string;
  repoId?: string;
  workingBranch?: string | null;
  terminalSessionKey?: string;
};

type TerminalSessionsState = {
  anchors: Record<string, HTMLElement | null>;
  bindings: Record<string, TerminalBinding>;
  setAnchor: (paneId: string, el: HTMLElement | null) => void;
  clearAnchorIfCurrent: (paneId: string, el: HTMLElement | null) => void;
  setBinding: (paneId: string, binding: TerminalBinding) => void;
  clearSession: (paneId: string) => void;
};

// Persists across renders so wterm instances (mounted inside <TerminalSession>)
// keep their wasm state when the owning pane unmounts and remounts after a
// split/reshape. createPortal on the stored anchor moves the DOM without
// unmounting the React subtree.
export const useTerminalSessionsStore = create<TerminalSessionsState>(
  (set) => ({
    anchors: {},
    bindings: {},
    setAnchor: (paneId, el) =>
      set((state) => {
        if (state.anchors[paneId] === el) return state;
        return { anchors: { ...state.anchors, [paneId]: el } };
      }),
    clearAnchorIfCurrent: (paneId, el) =>
      set((state) => {
        if (!(paneId in state.anchors)) return state;
        if (state.anchors[paneId] !== el) return state;
        return { anchors: { ...state.anchors, [paneId]: null } };
      }),
    setBinding: (paneId, binding) =>
      set((state) => {
        const prev = state.bindings[paneId];
        if (
          prev &&
          prev.sandboxId === binding.sandboxId &&
          prev.repoId === binding.repoId &&
          prev.workingBranch === binding.workingBranch &&
          prev.terminalSessionKey === binding.terminalSessionKey
        ) {
          return state;
        }
        return { bindings: { ...state.bindings, [paneId]: binding } };
      }),
    clearSession: (paneId) =>
      set((state) => {
        if (!(paneId in state.anchors) && !(paneId in state.bindings)) {
          return state;
        }
        const { [paneId]: _anchor, ...anchors } = state.anchors;
        const { [paneId]: _binding, ...bindings } = state.bindings;
        return { anchors, bindings };
      }),
  })
);
