"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useSWRConfig } from "swr";
import type { Repo } from "@/lib/types";
import { fetchJsonArray, fetchJsonObject } from "@/lib/client-fetch";
import { AsciiLoader } from "@/components/ascii-loader";
import { Button } from "@/components/ui/button";
import { getActiveTeamRequestHeaders, useActiveTeamId } from "@/components/active-scope-provider";
import { ControlShell, type ControlShellProps } from "./control-shell";
import { loadControlSessionList } from "./session-list-data";
import { visibleScopedRepos } from "@/lib/repos-visibility";

/** Resolve entry points before restoring a remembered, potentially unrelated task. */
export function ControlEntry(props: ControlShellProps) {
  const search = useSearchParams();
  const teamId = useActiveTeamId();
  const { mutate } = useSWRConfig();
  const repoId = search.get("repo");
  const runId = search.get("run");
  const mission = search.get("mission") ?? undefined;
  const key = mission ? "" : runId ? `run:${runId}` : repoId ? `repo:${teamId ?? "personal"}:${repoId}` : "";
  const [resolved, setResolved] = useState<{ key: string; missionId?: string; repo?: Repo }>();
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!key) return;
    let active = true;
    setError(null);
    void (async () => {
      if (runId) {
        const session = await fetchJsonObject<{ id: string }>(`/api/control/runs/${encodeURIComponent(runId)}`, "Could not open this run", { method: "POST" });
        if (active) setResolved({ key, missionId: session.id });
        return;
      }
      const [repos, sessions] = await Promise.all([
        fetchJsonArray<Repo>("/api/repos?show_hidden=true", "Could not load repositories", { headers: getActiveTeamRequestHeaders(undefined, teamId) }),
        loadControlSessionList(),
      ]);
      if (!active) return;
      // The picker and selected task must use the same fresh scope snapshot.
      await mutate(["/api/repos?show_hidden=true", teamId], repos, { revalidate: false });
      const repo = visibleScopedRepos(repos).find(item => item.id === repoId);
      if (!repo) throw new Error("Repository is not available. Check its connection and try again.");
      const recent = sessions.filter(item => item.repo_id === repo.id).sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
      if (active) setResolved({ key, missionId: recent?.id, repo: recent ? undefined : repo });
    })().catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "Could not open this workspace"); });
    return () => { active = false; };
  }, [key, repoId, runId, attempt, teamId, mutate]);
  if (!key) return <ControlShell {...props} initialMissionId={mission} />;
  if (resolved?.key === key) return <ControlShell {...props} initialMissionId={resolved.missionId} initialRepo={resolved.repo} />;
  return <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
    {error ? <><p role="alert" className="text-sm text-destructive">{error}</p><Button variant="outline" onClick={() => setAttempt(value => value + 1)}>Try again</Button></> : <AsciiLoader />}
  </div>;
}
