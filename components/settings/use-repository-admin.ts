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

/** Owner login for grouping and bulk removal. */
export function repoOwner(repo: Repo) {
  return repo.owner || repo.full_name.split("/")[0] || "owner";
}

/**
 * Repository admin for Settings: GitHub sync plus remove/restore of
 * connected repositories, against the shared repos cache.
 */
export function useRepositoryAdmin() {
  const activeTeamId = useActiveTeamId();
  const { user } = useUser();
  const githubSetup = presentGithubSetup(user);
  const { repos, isLoading, error, mutate } = useRepos({ showHidden: true });
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

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
      });
      if (!res.ok) throw new Error("Could not update repository visibility");
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
      try {
        await setHidden(repo, !restoring);
        toast({
          title: restoring ? "Repository restored" : "Repository removed",
          description: repo.full_name,
        });
      } catch {
        toast({
          title: restoring
            ? "Could not restore repository"
            : "Could not remove repository",
          description: `${repo.full_name}. Try again.`,
          variant: "destructive",
        });
      }
    },
    [setHidden]
  );

  const removeOwner = useCallback(
    async (owner: string) => {
      const targets = repos.filter(
        (repo) => repoOwner(repo) === owner && !repo.is_hidden
      );
      if (targets.length === 0) return;
      const results = await Promise.allSettled(
        targets.map((repo) => setHidden(repo, true))
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      const removed = results.length - failed;
      toast(
        failed
          ? {
              title: "Could not remove all repositories",
              description: `${removed} removed; ${failed} could not be removed. Try again.`,
              variant: "destructive",
            }
          : {
              title: `Removed ${removed} ${removed === 1 ? "repository" : "repositories"}`,
              description: owner,
            }
      );
    },
    [repos, setHidden]
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
    removeOwner,
  };
}
