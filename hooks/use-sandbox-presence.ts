"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  getActiveTeamRequestHeaders,
  useActiveTeamId,
} from "@/components/active-scope-provider";

export type SandboxPresenceEntry = {
  sandboxRecordId: string;
  sessionId: string;
};

const TAB_ID_STORAGE_KEY = "mogplex:sandbox-presence-tab-id";
const EVENT_SEQ_STORAGE_KEY = "mogplex:sandbox-presence-event-seq";
// Client-only fallback for private-mode/sessionStorage failures. In normal
// browsers the stable values live in per-tab sessionStorage.
let fallbackIdCounter = 0;
let fallbackEventSeq = 0;

function createFallbackId() {
  fallbackIdCounter += 1;
  return `${Date.now().toString(36)}-${fallbackIdCounter.toString(36)}`;
}

function getSandboxPresenceTabId() {
  if (typeof window === "undefined") return "server";
  try {
    const existing = window.sessionStorage.getItem(TAB_ID_STORAGE_KEY);
    if (existing) return existing;
    const next =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : createFallbackId();
    window.sessionStorage.setItem(TAB_ID_STORAGE_KEY, next);
    return next;
  } catch {
    return createFallbackId();
  }
}

function nextSandboxPresenceEventSeq() {
  if (typeof window === "undefined") {
    fallbackEventSeq += 1;
    return fallbackEventSeq;
  }
  try {
    const current = Number(
      window.sessionStorage.getItem(EVENT_SEQ_STORAGE_KEY) ?? "0"
    );
    const next = Number.isFinite(current) ? Math.max(0, current) + 1 : 1;
    window.sessionStorage.setItem(EVENT_SEQ_STORAGE_KEY, String(next));
    return next;
  } catch {
    fallbackEventSeq += 1;
    return fallbackEventSeq;
  }
}

function presenceKey(entry: SandboxPresenceEntry) {
  return `${entry.sandboxRecordId}:${entry.sessionId}`;
}

function normalizePresenceEntries(entries: SandboxPresenceEntry[]) {
  const deduped = new Map<string, SandboxPresenceEntry>();
  for (const entry of entries) {
    if (!entry.sandboxRecordId || !entry.sessionId) continue;
    deduped.set(presenceKey(entry), entry);
  }
  return [...deduped.values()].sort((a, b) =>
    presenceKey(a).localeCompare(presenceKey(b))
  );
}

function sendSandboxPresenceEvent(
  entry: SandboxPresenceEntry,
  input: {
    event: "attach" | "release";
    tabId: string;
    activeTeamId: string | null;
    reason?: string;
    keepalive?: boolean;
  }
) {
  const body = JSON.stringify({
    event: input.event,
    tabId: input.tabId,
    sessionId: entry.sessionId,
    eventSeq: nextSandboxPresenceEventSeq(),
    reason: input.reason,
  });

  void fetch(`/api/sandbox/${entry.sandboxRecordId}/presence`, {
    method: "POST",
    headers: getActiveTeamRequestHeaders(
      { "Content-Type": "application/json" },
      input.activeTeamId
    ),
    body,
    keepalive: input.keepalive,
  }).catch(() => {
    // Presence is best-effort. The existing idle reaper remains the fallback.
  });
}

export function useSandboxPresence(entries: SandboxPresenceEntry[]) {
  const activeTeamId = useActiveTeamId();
  const activeTeamIdRef = useRef(activeTeamId);
  const tabIdRef = useRef<string | null>(null);
  const attachedRef = useRef(new Map());
  const normalizedEntries = useMemo(
    () => normalizePresenceEntries(entries),
    [entries]
  );
  activeTeamIdRef.current = activeTeamId;

  useEffect(() => {
    tabIdRef.current ??= getSandboxPresenceTabId();
    const tabId = tabIdRef.current;
    const currentActiveTeamId = activeTeamIdRef.current;
    const next = new Map(
      normalizedEntries.map((entry) => [presenceKey(entry), entry])
    );
    const attached = attachedRef.current;

    for (const [key, entry] of next) {
      if (attached.has(key)) continue;
      sendSandboxPresenceEvent(entry, {
        event: "attach",
        tabId,
        activeTeamId: currentActiveTeamId,
      });
    }

    for (const [key, entry] of attached) {
      if (next.has(key)) continue;
      sendSandboxPresenceEvent(entry, {
        event: "release",
        tabId,
        activeTeamId: currentActiveTeamId,
        reason: "session_detached",
      });
    }

    attachedRef.current = next;
  }, [normalizedEntries]);

  useEffect(() => {
    const releaseAll = (reason: string, keepalive: boolean) => {
      const tabId = tabIdRef.current ?? getSandboxPresenceTabId();
      for (const entry of attachedRef.current.values()) {
        sendSandboxPresenceEvent(entry, {
          event: "release",
          tabId,
          activeTeamId: activeTeamIdRef.current,
          reason,
          keepalive,
        });
      }
    };

    const handlePageHide = () => {
      releaseAll("pagehide", true);
    };
    const handlePageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      const tabId = tabIdRef.current ?? getSandboxPresenceTabId();
      for (const entry of attachedRef.current.values()) {
        sendSandboxPresenceEvent(entry, {
          event: "attach",
          tabId,
          activeTeamId: activeTeamIdRef.current,
        });
      }
    };

    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("pageshow", handlePageShow);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("pageshow", handlePageShow);
      releaseAll("workspace_unmount", true);
      attachedRef.current = new Map();
    };
  }, []);
}
