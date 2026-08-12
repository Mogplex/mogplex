"use client";

import { useMemo } from "react";
import type { Repo, SandboxRecord } from "@/lib/types";
import { resolveControlSessionRepo } from "@/lib/control/session-project";
import type { ControlChatRequestContext } from "./control-chat-request";
import type { ControlSessionSummary } from "./session-list";

export function useControlSessionContext({
  activeSession,
  repos,
  allSandboxes,
  sessionId,
  selectedMissionId,
  missionTitle,
}: {
  activeSession: ControlSessionSummary | null;
  repos: Repo[];
  allSandboxes: SandboxRecord[];
  sessionId: string | null;
  selectedMissionId: string;
  missionTitle: string | null;
}) {
  const activeRepo = useMemo(
    () => resolveControlSessionRepo(activeSession, repos),
    [activeSession, repos]
  );

  const sandboxes = useMemo(
    () =>
      activeRepo
        ? allSandboxes.filter((sandbox) => sandbox.repo_id === activeRepo.id)
        : [],
    [activeRepo, allSandboxes]
  );
  const activeSandbox = sandboxes[0] ?? null;

  const requestContext = useMemo<ControlChatRequestContext>(() => {
    const [fallbackOwner, fallbackName] =
      activeRepo?.full_name.split("/") ?? [];
    const baseBranch =
      activeSandbox?.base_branch ?? activeRepo?.default_branch ?? "main";
    return {
      conversationId: sessionId,
      missionId: sessionId ?? selectedMissionId ?? null,
      missionTitle,
      repoId: activeRepo?.id ?? null,
      repoFullName: activeRepo?.full_name ?? null,
      repoOwner: activeRepo?.owner ?? fallbackOwner ?? null,
      repoName: activeRepo?.name ?? fallbackName ?? null,
      repoBranch: activeSandbox?.working_branch ?? baseBranch,
      repoBaseBranch: baseBranch,
      sandboxId: activeSandbox?.id ?? null,
    };
  }, [activeRepo, activeSandbox, missionTitle, selectedMissionId, sessionId]);

  return { activeRepo, sandboxes, activeSandbox, requestContext };
}
