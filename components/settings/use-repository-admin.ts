"use client";

import { useCallback, useState } from "react";
import {
  getActiveTeamRequestHeaders,
  useActiveTeamId,
} from "@/components/active-scope-provider";
import { useRepos } from "@/hooks/use-repos";
import { useUser } from "@/hooks/use-user";
import { toast } from "@/hooks/use-toast";
import { trackActivation } from "@/lib/activation-tracking";
import {
  presentGithubSetup,
  presentRepoSyncFailure,
} from "@/lib/activation/setup-state";
import type { Repo } from "@/lib/types";

function errorMessage(err: unknown) {
  return err instanceof Error
    ? err.message
    : "Could not update repository visibility. Try again.";
}

/** Repository visibility writes in flight at once during a bulk removal. */
const WRITE_WAVE = 6;

/**
 * Repository admin for Settings: GitHub sync plus remove/restore of
 * connected repositories, against the shared repos cache. `pendingIds` holds
 * repositories with a visibility write in flight so rows can't double-submit.
 */

export function useRepositoryAdmin() {
  const activeTeamId = useActiveTeamId();
  const { user } = useUser();
  const githubSetup = presentGithubSetup(user);
  const { repos, isLoading, error, mutate } = useRepos({ showHidden: true });
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const [removingOwner, setRemovingOwner] = useState(false);
  const [removalProgress, setRemovalProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);

  const markPending = useCallback((ids: string[], pending: boolean) => {
    setPendingIds((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (pending) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  const sync = useCallback(async () => {
    setSyncing(true);
    setSyncError(null);
    trackActivation("repo_sync_started", { source: "settings_repositories" });
    try {
      const res = await fetch("/api/github/repos", {
        headers: getActiveTeamRequestHeaders(undefined, activeTeamId),
      });
      const data = (await res.json()) as unknown;
      if (!res.ok) {
        const code =
          data && typeof data === "object" && "error" in data
            ? String((data as { error: unknown }).error)
            : null;
        setSyncError(presentRepoSyncFailure(code, githubSetup.connectLabel));
        trackActivation("repo_sync_failed", {
          source: "settings_repositories",
          error_code: code ?? "unknown_error",
        });
        return;
      }
      // Revalidate the full collection: the sync response is visible-only.
      await mutate();
      trackActivation("repo_sync_completed", {
        source: "settings_repositories",
        repo_count: Array.isArray(data) ? data.length : 0,
      });
    } catch {
      setSyncError(
        presentRepoSyncFailure("GITHUB_SYNC_ERROR", githubSetup.connectLabel)
      );
    } finally {
      setSyncing(false);
    }
  }, [activeTeamId, githubSetup.connectLabel, mutate]);

  const setHidden = useCallback(
    async (repo: Repo, hidden: boolean) => {
      const res = await fetch("/api/repos", {
        method: "PATCH",
        headers: getActiveTeamRequestHeaders(
          { "Content-Type": "application/json" },
          activeTeamId
        ),
        body: JSON.stringify({ id: repo.id, is_hidden: hidden }),
      }).catch(() => {
        throw new Error(
          "Could not reach Mogplex. Check your connection and try again."
        );
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: unknown;
        } | null;
        throw new Error(
          typeof data?.error === "string" && data.error
            ? data.error
            : "Could not update repository visibility. Try again."
        );
      }
      const updated = (await res.json()) as Repo;
      if (updated.id !== repo.id || updated.is_hidden !== hidden) {
        throw new Error("Repository visibility was not confirmed");
      }
      await mutate(
        (current) =>
          (current ?? []).map((item) =>
            item.id === updated.id ? updated : item
          ),
        { revalidate: false }
      );
    },
    [activeTeamId, mutate]
  );

  const toggleHidden = useCallback(
    async (repo: Repo) => {
      const restoring = Boolean(repo.is_hidden);
      markPending([repo.id], true);
      try {
        await setHidden(repo, !restoring);
        toast({
          variant: restoring ? "success" : "info",
          title: restoring ? "Repository restored" : "Repository removed",
          description: repo.full_name,
        });
      } catch (err) {
        toast({
          title: restoring
            ? `Could not restore ${repo.full_name}`
            : `Could not remove ${repo.full_name}`,
          description: errorMessage(err),
          variant: "destructive",
        });
      } finally {
        markPending([repo.id], false);
      }
    },
    [markPending, setHidden]
  );

  /**
   * Hide exactly `targets`; `description` names the set in the result toast.
   * Callers pass the same list they count and show, so a bulk removal never
   * hides more than its confirmation described.
   */
  const removeRepos = useCallback(
    async (targets: Repo[], description: string) => {
      if (targets.length === 0) return;
      const ids = targets.map((repo) => repo.id);
      setRemovingOwner(true);
      markPending(ids, true);
      const results: PromiseSettledResult<void>[] = [];
      setRemovalProgress({ done: 0, total: targets.length });
      try {
        // Waves the size of the browser's per-host connection pool: every
        // target is still written, without hundreds of requests queued at once.
        for (let start = 0; start < targets.length; start += WRITE_WAVE) {
          results.push(
            ...(await Promise.allSettled(
              targets
                .slice(start, start + WRITE_WAVE)
                .map((repo) => setHidden(repo, true))
            ))
          );
          setRemovalProgress({ done: results.length, total: targets.length });
        }
      } finally {
        setRemovalProgress(null);
        setRemovingOwner(false);
        markPending(ids, false);
      }
      const failures = results.filter(
        (r): r is PromiseRejectedResult => r.status === "rejected"
      );
      const failed = failures.length;
      const removed = results.length - failed;
      toast(
        failed
          ? {
              title: "Could not remove all repositories",
              description: `${removed} removed; ${failed} could not be removed. ${errorMessage(failures[0]?.reason)}`,
              variant: removed > 0 ? "warning" : "destructive",
            }
          : {
              variant: "info",
              title: `Removed ${removed} ${removed === 1 ? "repository" : "repositories"}`,
              description,
            }
      );
    },
    [markPending, setHidden]
  );

  return {
    repos,
    isLoading,
    loadError: error?.message ?? null,
    githubSetup,
    syncing,
    syncError,
    sync,
    toggleHidden,
    removeRepos,
    pendingIds,
    removingOwner,
    removalProgress,
  };
}
