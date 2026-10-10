"use client";

import { getActiveTeamRequestHeaders } from "@/components/active-scope-provider";
import { toast } from "@/hooks/use-toast";
import type { Repo } from "@/lib/types";
import { getRepoOwner, sortRepos } from "./helpers";
import type { RepoActionsContext } from "./use-repo-actions";

async function updateVisibility(
  ctx: RepoActionsContext,
  repo: Repo,
  hidden: boolean
) {
  const response = await fetch("/api/repos", {
    method: "PATCH",
    headers: getActiveTeamRequestHeaders(
      { "Content-Type": "application/json" },
      ctx.activeTeamId
    ),
    body: JSON.stringify({ id: repo.id, is_hidden: hidden }),
  });
  if (!response.ok) throw new Error("Could not update repository visibility");
  const updated = (await response.json()) as Repo;
  if (updated.id !== repo.id || updated.is_hidden !== hidden)
    throw new Error("Repository visibility was not confirmed");
  ctx.setRepos((current) =>
    sortRepos(current.map((item) => (item.id === updated.id ? updated : item)))
  );
}

export function createHideRepo(ctx: RepoActionsContext) {
  return async (repo: Repo) => {
    try {
      await updateVisibility(ctx, repo, !repo.is_hidden);
      toast({
        title: repo.is_hidden ? "Repository restored" : "Repository removed",
        description: repo.full_name,
      });
      await ctx.fetchData();
    } catch {
      toast({
        title: repo.is_hidden
          ? "Could not restore repository"
          : "Could not remove repository",
        description: `${repo.full_name}. Try again.`,
        variant: "destructive",
      });
    }
  };
}

export function createHideByOwner(ctx: RepoActionsContext) {
  return async (owner: string) => {
    const repos = ctx.repos.filter(
      (repo) => getRepoOwner(repo) === owner && !repo.is_hidden
    );
    if (repos.length === 0) return;
    const results = await Promise.allSettled(
      repos.map((repo) => updateVisibility(ctx, repo, true))
    );
    const failed = results.filter(
      (result) => result.status === "rejected"
    ).length;
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
    await ctx.fetchData();
  };
}
