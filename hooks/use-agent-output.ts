"use client";

import { create } from "zustand";

export const useSelectedAgent = create<{
  agentId: string | null;
  setAgentId: (id: string | null) => void;
}>((set) => ({
  agentId: null,
  setAgentId: (id) => set({ agentId: id }),
}));

export const useOutputPaneTab = create<{
  tab: "activity" | "calls" | "events";
  setTab: (tab: "activity" | "calls" | "events") => void;
}>((set) => ({
  tab: "activity",
  setTab: (tab) => set({ tab }),
}));
