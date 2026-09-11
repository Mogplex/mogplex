"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { ControlSessionSummary } from "@/lib/control/session-types";
import { toast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { loadControlSessionList } from "./session-list-data";

export type SetSessionArchived = (session: ControlSessionSummary, archived: boolean) => Promise<ControlSessionSummary | null>;

export function useSessionArchive({ setSessionArchived, canArchiveSession }: {
  setSessionArchived: SetSessionArchived;
  canArchiveSession: (id: string) => boolean;
}) {
  const [viewing, setViewing] = useState(false);
  const [sessions, setSessions] = useState<ControlSessionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const loadRevision = useRef(0);
  const canArchiveRef = useRef(canArchiveSession);
  useLayoutEffect(() => { canArchiveRef.current = canArchiveSession; }, [canArchiveSession]);

  const show = useCallback(async () => {
    setViewing(true);
    setLoading(true);
    setError(null);
    const revision = ++loadRevision.current;
    try {
      const archived = await loadControlSessionList(true);
      if (revision === loadRevision.current) setSessions(archived);
    } catch {
      if (revision === loadRevision.current) setError("Could not load archived chats. Try again.");
    } finally {
      if (revision === loadRevision.current) setLoading(false);
    }
  }, []);

  const change = useCallback(async (targets: ControlSessionSummary[], archived: boolean) => {
    if (pending.current) return { changed: [], failed: 0, skipped: 0 };
    pending.current = true;
    setBusy(true);
    setError(null);
    const changed: ControlSessionSummary[] = [];
    let failed = 0;
    let skipped = 0;
    try {
      // Each request uses the displayed revision. A chat that changed since
      // it was listed stays visible; do not rebase an archive over new work.
      for (const target of targets) {
        if (archived && !canArchiveRef.current(target.id)) { skipped++; continue; }
        const result = await setSessionArchived(target, archived).catch(() => null);
        if (result) changed.push(result);
        else failed++;
      }
      loadRevision.current++;
      setLoading(false);
      const ids = new Set(changed.map(session => session.id));
      setSessions(current => archived
        ? [...changed, ...current.filter(session => !ids.has(session.id))]
        : current.filter(session => !ids.has(session.id)));
      if (failed) {
        const message = `Could not ${archived ? "archive" : "restore"} ${failed} ${failed === 1 ? "chat" : "chats"}. Try again.`;
        setError(message);
        if (!archived || !changed.length) toast({ title: message, variant: "destructive" });
      } else if (!changed.length && skipped) {
        toast({ title: "Chats with active or unsaved work stay in the sidebar." });
      }
      return { changed, failed, skipped };
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }, [setSessionArchived]);

  const archive = useCallback(async (targets: ControlSessionSummary[]) => {
    const { changed, failed, skipped } = await change(targets, true);
    if (!changed.length) return;
    toast({
      title: `${changed.length} ${changed.length === 1 ? "chat" : "chats"} archived`,
      description: failed ? `${failed} could not be archived. Try again.` : skipped ? "Chats with active or unsaved work stay in the sidebar." : undefined,
      action: <ToastAction altText="Restore archived chats" onClick={() => { void change(changed, false); }}>Undo</ToastAction>,
    });
  }, [change]);

  return {
    viewing, sessions, loading, busy, error, show, archive,
    back: () => { loadRevision.current++; setLoading(false); setViewing(false); setError(null); },
    restore: (session: ControlSessionSummary) => change([session], false),
  };
}

export type SessionArchiveControls = ReturnType<typeof useSessionArchive>;
