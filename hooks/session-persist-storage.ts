import type { StateStorage } from "zustand/middleware";

const PERSIST_DELAY_MS = 100;
const pendingWrites = new Map<string, string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flushPendingWrites() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  for (const [name, value] of pendingWrites) {
    try {
      localStorage.setItem(name, value);
    } catch (error) {
      console.error("[session-persist] failed to write", {
        name,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
  pendingWrites.clear();
}

export const sessionPersistStorage: StateStorage = {
  getItem: (name) => localStorage.getItem(name),
  setItem: (name, value) => {
    pendingWrites.set(name, value);
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(flushPendingWrites, PERSIST_DELAY_MS);
  },
  removeItem: (name) => {
    pendingWrites.delete(name);
    localStorage.removeItem(name);
  },
};

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushPendingWrites);
  window.addEventListener("visibilitychange", flushPendingWrites);
}
