"use client";

import { useEffect } from "react";
import { scopedHref } from "@/lib/scoped-href";

export function useControlSessionUrl({
  scope,
  searchParams,
  sessionId,
  sessions,
  sessionsLoaded,
}: {
  scope: string | undefined;
  searchParams: Pick<URLSearchParams, "get" | "toString">;
  sessionId: string | null;
  sessions: Array<{ id: string }>;
  sessionsLoaded: boolean;
}) {
  useEffect(() => {
    // replaceState does not update Next's searchParams snapshot, so read the
    // address bar to reconcile a later archive against the latest URL.
    const next = new URLSearchParams(window.location.search);
    if (sessionId) {
      if (next.get("mission") === sessionId) return;
      next.set("mission", sessionId);
    } else {
      if (!sessionsLoaded) return;
      const mission = next.get("mission");
      if (!mission || sessions.some((entry) => entry.id === mission)) return;
      next.delete("mission");
    }

    const query = next.toString();
    window.history.replaceState(
      window.history.state,
      "",
      `${scopedHref(scope, "/control")}${query ? `?${query}` : ""}`
    );
  }, [scope, searchParams, sessionId, sessions, sessionsLoaded]);
}
