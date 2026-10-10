"use client";

import { useRepos } from "@/hooks/use-repos";
import { useRealtimeRouteRefresh } from "@/hooks/use-realtime-route-refresh";
import { workspaceRepoState } from "@/lib/repos-visibility";

const repoEvents = [{ table: "repos", filter: "user_id=eq.$USER_ID" }];

export function useWorkspaceRepo(repoId: string | null | undefined) {
  const result = useRepos({ showHidden: true, enabled: Boolean(repoId) });
  useRealtimeRouteRefresh({
    channelName: `workspace-repository:${repoId ?? "none"}`,
    specs: repoEvents,
    enabled: Boolean(repoId),
    onInvalidate: result.mutate,
  });
  return {
    ...result,
    state: workspaceRepoState(
      repoId,
      result.repos,
      result.isLoading,
      result.error
    ),
    repo: result.repos.find((item) => item.id === repoId),
  };
}
