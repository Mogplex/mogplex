"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Repo, Agent, Assignment, Workspace } from "@/lib/types";
import { useSandboxStore } from "@/hooks/use-sandbox";
import { useUser } from "@/hooks/use-user";
import {
  getActiveTeamRequestHeaders,
  useActiveTeamId,
} from "@/components/active-scope-provider";
import { trackActivation } from "@/lib/activation-tracking";
import {
  presentGithubSetup,
  presentRepoSyncFailure,
  presentVercelSetup,
} from "@/lib/activation/setup-state";
import { createClient as createSupabaseClient } from "@/lib/supabase/client";
import { useTableEvents } from "@/hooks/use-table-events";
import { useSandboxLaunchActions } from "@/components/sandbox-launch-provider";
import { sortRepos, sortWorkspaces } from "./helpers";
import type { RepoDashboardProps } from "./types";
import {
  createToggleFavorite,
  createHideRepo,
  createHideByOwner,
  createSaveRepoSettings,
  createRestartRepoSandbox,
  createHandleLaunchSandbox,
  createHandleStopSandbox,
  createHandleDeleteWorkspace,
} from "./use-repo-actions";
import { useRepoDashboardDerived, useFilteredRepos } from "./use-repo-derived";

const useNeonBackend = process.env.NEXT_PUBLIC_MOGPLEX_DATA_BACKEND === "neon";

export function useRepoDashboard({
  onOpenChat,
  onReposLoaded,
}: RepoDashboardProps) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [search, setSearch] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [showHidden, setShowHidden] = useState(false);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [selected, setSelected] = useState<string | null>(null);
  const [editingRepo, setEditingRepo] = useState<Repo | null>(null);
  const [editingWorkspace, setEditingWorkspace] = useState<Workspace | null>(
    null
  );
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [creatingRepoWorkspace, setCreatingRepoWorkspace] =
    useState<Workspace | null>(null);
  const [browsingMonorepo, setBrowsingMonorepo] = useState<Repo | null>(null);
  const [syncingRepos, setSyncingRepos] = useState(false);
  const [repoSyncError, setRepoSyncError] = useState<string | null>(null);
  const [dataLoadError, setDataLoadError] = useState<string | null>(null);
  const [hasAttemptedRepoSync, setHasAttemptedRepoSync] = useState(false);
  const [hasLoadedInitialRepos, setHasLoadedInitialRepos] = useState(false);

  const sandboxes = useSandboxStore((state) => state.sandboxes);
  const sandboxesById = useSandboxStore((state) => state.sandboxesById);
  const hasCreatingForRepo = useSandboxStore(
    (state) => state.hasCreatingForRepo
  );
  const refreshSandboxes = useSandboxStore((state) => state.refresh);
  const launchSandbox = useSandboxStore((state) => state.launch);
  const stopSandbox = useSandboxStore((state) => state.stop);
  const getSandboxForRepo = useSandboxStore((state) => state.getSandboxForRepo);
  const { launchRepoSandbox } = useSandboxLaunchActions();
  const { user } = useUser();
  const activeTeamId = useActiveTeamId();
  const githubSetup = presentGithubSetup(user);
  const vercelSetup = presentVercelSetup(user);
  const connectGithubLabel = githubSetup.connectLabel;

  const parseRouteError = useCallback(
    async (response: Response, fallback: string) => {
      try {
        const data = (await response.json()) as { error?: unknown };
        if (typeof data?.error === "string" && data.error.trim()) {
          return data.error.trim();
        }
      } catch {
        // Ignore parse failures and use the fallback message.
      }
      return fallback;
    },
    []
  );

  const fetchWorkspaces = useCallback(async () => {
    const response = await fetch("/api/workspaces", {
      headers: getActiveTeamRequestHeaders(undefined, activeTeamId),
    });
    if (!response.ok) {
      throw new Error(
        await parseRouteError(response, "Failed to load projects")
      );
    }
    const data = await response.json();
    return sortWorkspaces(Array.isArray(data) ? data : []);
  }, [activeTeamId, parseRouteError]);

  const syncGithubRepos = useCallback(
    async (source = "repo_dashboard") => {
      setDataLoadError(null);
      setRepoSyncError(null);
      setSyncingRepos(true);
      trackActivation("repo_sync_started", { source });
      try {
        const res = await fetch("/api/github/repos", {
          headers: getActiveTeamRequestHeaders(undefined, activeTeamId),
        });
        const data = await res.json();

        if (res.ok) {
          const syncedRepos = sortRepos(data);
          const nextWorkspaces = await fetchWorkspaces();
          setRepos(syncedRepos);
          setWorkspaces(nextWorkspaces);
          onReposLoaded?.(syncedRepos, agents);
          trackActivation("repo_sync_completed", {
            source,
            repo_count: syncedRepos.length,
          });
          return;
        }

        const errorCode =
          data.error === "NO_GITHUB_TOKEN" ||
          data.error === "NO_GITHUB_CONNECTION"
            ? data.error
            : data.error || "unknown_error";
        setRepoSyncError(
          presentRepoSyncFailure(
            typeof data.error === "string" ? data.error : null,
            connectGithubLabel
          )
        );
        trackActivation("repo_sync_failed", { source, error_code: errorCode });
      } catch {
        setRepoSyncError(
          presentRepoSyncFailure("GITHUB_SYNC_ERROR", connectGithubLabel)
        );
        trackActivation("repo_sync_failed", {
          source,
          error_code: "network_error",
        });
      } finally {
        setSyncingRepos(false);
      }
    },
    [activeTeamId, connectGithubLabel, agents, fetchWorkspaces, onReposLoaded]
  );

  const fetchData = useCallback(async () => {
    setDataLoadError(null);
    const repoUrl = showHidden ? "/api/repos?show_hidden=true" : "/api/repos";

    try {
      const [
        workspaceResponse,
        repoResponse,
        agentResponse,
        assignmentResponse,
      ] = await Promise.all([
        fetchWorkspaces(),
        fetch(repoUrl, {
          headers: getActiveTeamRequestHeaders(undefined, activeTeamId),
        }).then(async (res) => {
          if (!res.ok) {
            throw new Error(
              await parseRouteError(res, "Failed to load repositories")
            );
          }
          return res.json();
        }),
        fetch("/api/agents").then((res) => (res.ok ? res.json() : [])),
        fetch("/api/assignments").then((res) => (res.ok ? res.json() : [])),
      ]);
      const sorted = sortRepos(repoResponse);
      setWorkspaces(workspaceResponse);
      setRepos(sorted);
      setAgents(agentResponse);
      setAssignments(assignmentResponse);
      setHasLoadedInitialRepos(true);
      onReposLoaded?.(sorted, agentResponse);
    } catch (error) {
      setWorkspaces([]);
      setRepos([]);
      setAgents([]);
      setAssignments([]);
      setDataLoadError(
        (error as Error).message || "Failed to load projects and spaces"
      );
    }
  }, [
    activeTeamId,
    fetchWorkspaces,
    onReposLoaded,
    parseRouteError,
    showHidden,
  ]);

  useEffect(() => {
    void fetchData();
    void refreshSandboxes();
  }, [fetchData, refreshSandboxes]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const githubConnected = params.get("github") === "connected";
    const repoSyncFailed = params.get("repo_sync") === "failed";

    if (!githubConnected && !repoSyncFailed) return;

    if (repoSyncFailed) {
      setRepoSyncError(
        presentRepoSyncFailure("GITHUB_SYNC_ERROR", connectGithubLabel)
      );
    }
    if (githubConnected) {
      setHasAttemptedRepoSync(true);
      void syncGithubRepos("repo_dashboard_post_connect");
    }

    params.delete("github");
    params.delete("repo_sync");
    const nextQuery = params.toString();
    const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}${window.location.hash}`;
    window.history.replaceState({}, "", nextUrl);
  }, [connectGithubLabel, syncGithubRepos]);

  useEffect(() => {
    if (
      !hasLoadedInitialRepos ||
      dataLoadError ||
      !githubSetup.canSyncRepos ||
      hasAttemptedRepoSync
    )
      return;
    setHasAttemptedRepoSync(true);
    void syncGithubRepos("repo_dashboard_auto");
  }, [
    dataLoadError,
    githubSetup.canSyncRepos,
    hasAttemptedRepoSync,
    syncGithubRepos,
    hasLoadedInitialRepos,
  ]);

  useTableEvents({
    tables: ["repos"],
    enabled: useNeonBackend && Boolean(user?.id),
    onEvent: () => {
      void fetchData();
    },
  });

  useEffect(() => {
    if (useNeonBackend || !user?.id) return;

    const supabase = createSupabaseClient();
    const channel = supabase
      .channel(`repos:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "repos",
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          void fetchData();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user?.id, fetchData]);

  const filteredRepos = useFilteredRepos({
    ownerFilter,
    repos,
    search,
    showHidden,
  });

  const derived = useRepoDashboardDerived({
    agents,
    assignments,
    filteredRepos,
    ownerFilter,
    repos,
    sandboxesById,
    search,
    workspaces,
  });

  const actionsContext = useMemo(
    () => ({
      activeTeamId,
      agents,
      fetchData,
      getSandboxForRepo,
      launchRepoSandbox,
      launchSandbox,
      onReposLoaded,
      repos,
      setRepos,
      stopSandbox,
    }),
    [
      activeTeamId,
      agents,
      fetchData,
      getSandboxForRepo,
      launchRepoSandbox,
      launchSandbox,
      onReposLoaded,
      repos,
      stopSandbox,
    ]
  );

  const toggleFavorite = useMemo(
    () => createToggleFavorite(actionsContext),
    [actionsContext]
  );
  const hideRepo = useMemo(
    () => createHideRepo(actionsContext),
    [actionsContext]
  );
  const hideByOwner = useMemo(
    () => createHideByOwner(actionsContext),
    [actionsContext]
  );
  const saveRepoSettings = useMemo(
    () => createSaveRepoSettings(actionsContext),
    [actionsContext]
  );
  const restartRepoSandbox = useMemo(
    () => createRestartRepoSandbox(actionsContext, saveRepoSettings),
    [actionsContext, saveRepoSettings]
  );
  const handleLaunchSandbox = useMemo(
    () => createHandleLaunchSandbox(actionsContext),
    [actionsContext]
  );
  const handleStopSandbox = useMemo(
    () => createHandleStopSandbox(actionsContext),
    [actionsContext]
  );
  const handleDeleteWorkspace = useMemo(
    () => createHandleDeleteWorkspace(actionsContext),
    [actionsContext]
  );

  return {
    ...derived,
    agents,
    browsingMonorepo,
    connectGithubLabel,
    creatingRepoWorkspace,
    creatingWorkspace,
    dataLoadError,
    editingRepo,
    editingWorkspace,
    fetchData,
    filteredRepos,
    githubSetup,
    handleDeleteWorkspace,
    handleLaunchSandbox,
    handleStopSandbox,
    hasCreatingForRepo,
    hideByOwner,
    hideRepo,
    onOpenChat,
    ownerFilter,
    repoSyncError,
    repos,
    restartRepoSandbox,
    sandboxes,
    saveRepoSettings,
    search,
    selected,
    setBrowsingMonorepo,
    setCreatingRepoWorkspace,
    setCreatingWorkspace,
    setEditingRepo,
    setEditingWorkspace,
    setHasAttemptedRepoSync,
    setOwnerFilter,
    setSearch,
    setSelected,
    setShowHidden,
    setViewMode,
    showHidden,
    syncGithubRepos,
    syncingRepos,
    toggleFavorite,
    user,
    vercelSetup,
    viewMode,
    workspaces,
  };
}
