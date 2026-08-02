"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface FlowAssistantPanelState {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggleOpen: () => void;
}

export const useFlowAssistantPanel = create<FlowAssistantPanelState>()(
  persist(
    (set) => ({
      open: false,
      setOpen: (open) => set({ open }),
      toggleOpen: () => set((state) => ({ open: !state.open })),
    }),
    { name: "flow-assistant-panel" }
  )
);
