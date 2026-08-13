"use client";

import { useMemo } from "react";
import type { Repo, SandboxRecord } from "@/lib/types";
import { resolveControlSessionRepo } from "@/lib/control/session-project";
import type { ControlChatRequestContext } from "./control-chat-request";
import type { ControlSessionSummary } from "./session-list";

type ContextRepo = Pick<
  Repo,
  "id" | "full_name" | "owner" | "name" | "default_branch"
>;
type ContextSandbox = Pick<
  SandboxRecord,
  "id" | "working_branch" | "base_branch"
>;

export function selectControlSessionSandboxes<T extends { repo_id: string }>(
  activeRepo: { id: string } | null,
  allSandboxes: T[]
): T[] {
  if (!activeRepo) return [];
  return allSandboxes.filter((sandbox) => sandbox.repo_id === activeRepo.id);
}

export function buildControlSessionRequestContext({
  activeRepo,
  activeSandbox,
  sessionId,
  selectedMissionId,
  missionTitle,
}: {
  activeRepo: ContextRepo | null;
  activeSandbox: ContextSandbox | null;
  sessionId: string | null;
  selectedMissionId: string;
  missionTitle: string | null;
}): ControlChatRequestContext {
  const [fallbackOwner, fallbackName] = activeRepo?.full_name.split("/") ?? [];
  const baseBranch = activeRepo
    ? (activeSandbox?.base_branch ?? activeRepo.default_branch ?? "main")
    : null;
  return {
    conversationId: sessionId,
    missionId: (sessionId ?? selectedMissionId) || null,
    missionTitle,
    repoId: activeRepo?.id ?? null,
    repoFullName: activeRepo?.full_name ?? null,
    repoOwner: activeRepo?.owner ?? fallbackOwner ?? null,
    repoName: activeRepo?.name ?? fallbackName ?? null,
    repoBranch: activeRepo
      ? (activeSandbox?.working_branch ?? baseBranch)
      : null,
    repoBaseBranch: baseBranch,
    sandboxId: activeSandbox?.id ?? null,
  };
}

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
    () => selectControlSessionSandboxes(activeRepo, allSandboxes),
    [activeRepo, allSandboxes]
  );
  const activeSandbox = sandboxes[0] ?? null;

  const requestContext = useMemo(
    () =>
      buildControlSessionRequestContext({
        activeRepo,
        activeSandbox,
        sessionId,
        selectedMissionId,
        missionTitle,
      }),
    [activeRepo, activeSandbox, missionTitle, selectedMissionId, sessionId]
  );

  return { activeRepo, sandboxes, activeSandbox, requestContext };
}
