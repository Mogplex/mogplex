import { useConversationsStore } from "@/hooks/use-conversations";
import { collectPaneIds } from "@/hooks/use-split-panes";
import { useSessionsStore } from "@/hooks/use-sessions";

export function retargetSessionToSandbox(
  sessionId: string | null | undefined,
  previousSandboxId: string | null | undefined,
  nextSandboxId: string | null
) {
  if (!sessionId || !previousSandboxId || previousSandboxId === nextSandboxId) {
    return false;
  }

  const session = useSessionsStore
    .getState()
    .sessions.find((candidate) => candidate.id === sessionId);
  if (!session) return false;

  useSessionsStore.getState().setActiveSessionSandbox(nextSandboxId, {
    previousSandboxId,
    replacePaneSandboxIds: true,
    sessionId,
  });
  useConversationsStore
    .getState()
    .retargetHarnessSandboxIds(
      collectPaneIds(session.paneTree),
      previousSandboxId,
      nextSandboxId
    );

  return true;
}

export function ensureSessionSandboxBinding(
  sessionId: string | null | undefined,
  previousSandboxId: string | null | undefined,
  nextSandboxId: string | null
) {
  if (!sessionId || !nextSandboxId) {
    return false;
  }

  if (retargetSessionToSandbox(sessionId, previousSandboxId, nextSandboxId)) {
    return true;
  }

  useSessionsStore.getState().setActiveSessionSandbox(nextSandboxId, {
    previousSandboxId,
    replacePaneSandboxIds: true,
    sessionId,
  });

  return true;
}

export function bindSessionToPendingSandboxBranch(
  sessionId: string | null | undefined,
  pendingSandboxBranch: string | null | undefined
) {
  if (!sessionId) {
    return false;
  }

  useSessionsStore
    .getState()
    .setPendingSessionSandboxBranch(pendingSandboxBranch ?? null, {
      sessionId,
    });

  return true;
}
