"use client";

import { useMemo } from "react";
import type {
  Repo,
  Agent,
  Assignment,
  SandboxRecord,
  Workspace,
} from "@/lib/types";
import { filterRepos } from "@/lib/repo-search";
import {
  isSandboxUiReachablePreview,
  resolveSandboxUiState,
} from "@/lib/sandbox/ui-state";
import { getRepoOwner } from "./helpers";
import type { WorkspaceSection } from "./types";

export function useRepoDashboardDerived({
  agents,
  assignments,
  filteredRepos,
  ownerFilter,
  repos,
  sandboxesById,
  search,
  workspaces,
}: {
  agents: Agent[];
  assignments: Assignment[];
  filteredRepos: Repo[];
  ownerFilter: string;
  repos: Repo[];
  sandboxesById: Record<string, SandboxRecord | null | undefined>;
  search: string;
  workspaces: Workspace[];
}) {
  const owners = useMemo(() => {
    const values = new Set<string>();
    for (const repo of repos) {
      values.add(getRepoOwner(repo));
    }
    return [...values].sort();
  }, [repos]);

  const hiddenCount = useMemo(
    () => repos.filter((repo) => repo.is_hidden).length,
    [repos]
  );

  const repoAgentsMap = useMemo(() => {
    const map = new Map<string, Agent[]>();
    for (const assignment of assignments) {
      const agent = agents.find((item) => item.id === assignment.agent_id);
      if (!agent) continue;
      const existing = map.get(assignment.repo_id) || [];
      existing.push(agent);
      map.set(assignment.repo_id, existing);
    }
    return map;
  }, [assignments, agents]);

  const repoCronsMap = useMemo(() => {
    const map = new Map<string, Assignment[]>();
    for (const assignment of assignments) {
      if (assignment.type !== "cron_refactor" && assignment.type !== "cron")
        continue;
      const existing = map.get(assignment.repo_id) || [];
      existing.push(assignment);
      map.set(assignment.repo_id, existing);
    }
    return map;
  }, [assignments]);

  const activePreviewCount = useMemo(
    () =>
      Object.values(sandboxesById).filter((sandbox) =>
        isSandboxUiReachablePreview(
          resolveSandboxUiState({ session: null, record: sandbox ?? null })
        )
      ).length,
    [sandboxesById]
  );

  const visibleRepoCount = useMemo(
    () => repos.filter((repo) => !repo.is_hidden).length,
    [repos]
  );

  const workspaceSections = useMemo(() => {
    const sections = new Map<string, WorkspaceSection>();
    for (const workspace of workspaces) {
      sections.set(workspace.id, { workspace, repos: [] });
    }

    for (const repo of filteredRepos) {
      const workspaceId =
        repo.workspace_id && sections.has(repo.workspace_id)
          ? repo.workspace_id
          : "__synthetic_imported__";
      if (!sections.has(workspaceId)) {
        sections.set(workspaceId, {
          workspace: {
            id: workspaceId,
            user_id: repo.user_id,
            name: "Imported Repos",
            description: "Fallback bucket for repos without a loaded project.",
            is_default: true,
            repo_count: 0,
            created_at: repo.created_at,
            updated_at: repo.created_at,
          },
          repos: [],
        });
      }
      sections.get(workspaceId)?.repos.push(repo);
    }

    const showEmptyProjects = !search.trim() && ownerFilter === "all";
    return [...sections.values()]
      .filter((section) => section.repos.length > 0 || showEmptyProjects)
      .sort((a, b) => {
        const defaultOrder =
          Number(Boolean(b.workspace.is_default)) -
          Number(Boolean(a.workspace.is_default));
        if (defaultOrder !== 0) return defaultOrder;
        return a.workspace.name.localeCompare(b.workspace.name);
      });
  }, [filteredRepos, ownerFilter, search, workspaces]);

  const visibleWorkspaceCount = workspaceSections.length;

  return {
    activePreviewCount,
    hiddenCount,
    owners,
    repoAgentsMap,
    repoCronsMap,
    visibleRepoCount,
    visibleWorkspaceCount,
    workspaceSections,
  };
}

export function useFilteredRepos({
  ownerFilter,
  repos,
  search,
  showHidden,
}: {
  ownerFilter: string;
  repos: Repo[];
  search: string;
  showHidden: boolean;
}) {
  return useMemo(() => {
    let result = repos;
    if (!showHidden) {
      result = result.filter((repo) => !repo.is_hidden);
    }
    if (ownerFilter !== "all") {
      result = result.filter((repo) => getRepoOwner(repo) === ownerFilter);
    }
    return filterRepos(result, search);
  }, [search, repos, ownerFilter, showHidden]);
}
