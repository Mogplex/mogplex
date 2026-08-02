"use client";
import { create } from "zustand";

export type PreviewFeedback = {
  id: string;
  text: string;
  region?: { x: number; y: number; width: number; height: number };
  timestamp: number;
};

type PreviewFeedbackStore = {
  pending: PreviewFeedback | null;
  send: (feedback: PreviewFeedback) => void;
  consume: () => PreviewFeedback | null;
};

export const usePreviewFeedbackStore = create<PreviewFeedbackStore>(
  (set, get) => ({
    pending: null,
    send: (feedback) => set({ pending: feedback }),
    consume: () => {
      const current = get().pending;
      if (current) set({ pending: null });
      return current;
    },
  })
);
