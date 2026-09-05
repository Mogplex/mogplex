"use client";
import { useEffect, useState } from "react";
import { AsciiLoader } from "@/components/ascii-loader";
import { useSessionsHydrated, useSessionsStore } from "@/hooks/use-sessions";
import { bindRunWorkspace } from "@/lib/run-workspace/session";
import { runWorkspaceSchema } from "@/lib/run-workspace/types";
import { WorkspaceShell } from "./workspace-shell";

export function RunWorkspace({ runId }: { runId: string }) {
  const hydrated = useSessionsHydrated();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!hydrated) return;
    const abort = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/runs/${runId}/workspace`, { signal: abort.signal });
        if (!response.ok) throw new Error(response.status === 404 ? "Run not found or you do not have access." : "Could not open this run. Reload to try again.");
        const context = runWorkspaceSchema.parse(await response.json());
        if (abort.signal.aborted) return;
        useSessionsStore.setState(state => bindRunWorkspace(state.sessions, context));
        setReady(true);
      } catch (cause) {
        if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not open run");
      }
    })();
    return () => abort.abort();
  }, [hydrated, runId]);
  if (error) return <div role="alert" className="p-4">{error}</div>;
  return ready ? <WorkspaceShell /> : <div className="flex h-full items-center justify-center"><AsciiLoader /></div>;
}
