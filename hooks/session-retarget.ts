import { useConversationsStore } from "@/hooks/use-conversations";
import { collectPaneIds } from "@/hooks/use-split-panes";
import { useSessionsStore } from "@/hooks/use-sessions";

export function findWorkspaceSession(id: string | null) {
  return id
    ? (useSessionsStore
        .getState()
        .sessions.find((session) => session.id === id) ?? null)
    : null;
}

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
      previousSandboxId ?? null,
      nextSandboxId
    );

  return true;
}

export function restoreConversationSession(input: {
  workspaceSessionId: string | null;
  sandboxId: string | null;
}) {
  if (!input.workspaceSessionId) return;
  const sessions = useSessionsStore.getState();
  if (sessions.activeSessionId === input.workspaceSessionId) return;
  const target = findWorkspaceSession(input.workspaceSessionId);
  if (!target) return;

  sessions.switchSession(target.id);
  ensureSessionSandboxBinding(
    target.id,
    target.activeSandboxId,
    input.sandboxId
  );
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
