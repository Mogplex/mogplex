"use client";

import { create } from "zustand";

export type ProjectSettingsTab =
  | "env"
  | "general"
  | "secrets"
  | "skills"
  | "rules"
  | "models"
  | "snapshot";

export type ProjectSettingsRequest = {
  repoId: string;
  tab: ProjectSettingsTab;
  /** Variable names Control asked for, prefilled as empty rows. */
  requestedEnvNames?: string[];
};

type ProjectSettingsDrawerState = {
  request: ProjectSettingsRequest | null;
  open: (request: ProjectSettingsRequest) => void;
  setTab: (tab: ProjectSettingsTab) => void;
  close: () => void;
};

/**
 * The one project settings drawer in Control, opened from the sidebar's
 * project menu or a "Set variables" request in the timeline.
 */
export const useProjectSettingsDrawer = create<ProjectSettingsDrawerState>(
  (set) => ({
    request: null,
    open: (request) => set({ request }),
    setTab: (tab) =>
      set((state) =>
        state.request ? { request: { ...state.request, tab } } : state
      ),
    close: () => set({ request: null }),
  })
);
