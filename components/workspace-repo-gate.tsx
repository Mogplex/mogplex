"use client";

import { useState, type ReactNode } from "react";
import { SessionBar } from "@/components/session-bar";
import { Button } from "@/components/ui/button";
import { getActiveTeamRequestHeaders, useActiveTeamId } from "@/components/active-scope-provider";
import { useWorkspaceRepo } from "@/hooks/use-workspace-repo";
import { useSessionsStore } from "@/hooks/use-sessions";
import type { Repo } from "@/lib/types";

export function WorkspaceRepoGate({ children }: { children: ReactNode }) {
  const repoId = useSessionsStore(state => state.getActiveSession().activeRepo?.id);
  return <RepositoryGate key={repoId ?? "home"} repoId={repoId}>{children}</RepositoryGate>;
}

function RepositoryGate({ repoId, children }: { repoId?: string; children: ReactNode }) {
  const { state, repo, mutate } = useWorkspaceRepo(repoId);
  const teamId = useActiveTeamId();
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  async function restore() {
    if (!repo || restoring) return;
    setRestoring(true);
    setRestoreError(null);
    try {
      const response = await fetch("/api/repos", {
        method: "PATCH",
        headers: getActiveTeamRequestHeaders({ "Content-Type": "application/json" }, teamId),
        body: JSON.stringify({ id: repo.id, is_hidden: false }),
      });
      if (!response.ok) throw new Error("Restore failed");
      const updated = await response.json() as Repo;
      if (updated?.id !== repo.id || updated.is_hidden !== false) throw new Error("Restore was not confirmed");
      await mutate(current => current?.map(item => item.id === updated.id ? updated : item), { revalidate: false });
    } catch {
      setRestoreError("Could not restore repository. Try again.");
    } finally {
      setRestoring(false);
    }
  }

  if (state === "available") return children;
  return <div className="flex h-full min-h-0 flex-col bg-background">
    <SessionBar />
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-6">
      <section className="w-full max-w-md space-y-4 rounded-lg border border-border bg-card p-6">
        <h1 className="text-lg font-medium">{state === "loading" ? "Loading repository…" : state === "error" ? "Could not load repository" : state === "removed" ? "Repository removed" : "Repository unavailable"}</h1>
        {repo && <p className="break-words font-mono text-sm text-muted-foreground">{repo.full_name}</p>}
        <p className="text-sm text-muted-foreground">{state === "removed" ? "Restore this repository to reopen its saved workspace." : state === "error" ? "Retry to check this repository before opening its workspace." : state === "unavailable" ? "This repository is not available in the current scope. Select another workspace or check your repository connections." : "Checking the repository for this saved workspace."}</p>
        {restoreError && <p role="alert" className="text-sm text-destructive">{restoreError}</p>}
        {state === "removed" && <Button disabled={restoring} onClick={() => void restore()}>{restoring ? "Restoring…" : "Restore repository"}</Button>}
        {(state === "error" || state === "unavailable") && <Button variant="outline" onClick={() => void mutate().catch(() => {})}>Retry</Button>}
      </section>
    </div>
  </div>;
}
