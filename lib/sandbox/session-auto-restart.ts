import {
  isSandboxUiErrored,
  isSandboxUiStopped,
  resolveSandboxUiState,
} from "@/lib/sandbox/ui-state";
import type { SandboxRecord } from "@/lib/types";

export type SessionSandboxRestartCandidate = {
  repoId: string;
  sessionId: string;
  previousSandboxId: string;
  pendingSandboxBranch: string | null;
};

function blocksImplicitRestart(record: SandboxRecord) {
  return (
    record.stop_reason === "manual" || record.stop_reason === "billing_depleted"
  );
}

export function getSessionSandboxRestartCandidate({
  activeRepoId,
  activeSessionId,
  activeSessionSandbox,
  activeSessionSandboxId,
  autoRestartedSandboxId,
  sandboxCreating,
}: {
  activeRepoId: string | undefined;
  activeSessionId: string;
  activeSessionSandbox: SandboxRecord | null;
  activeSessionSandboxId: string | null;
  autoRestartedSandboxId: string | null;
  sandboxCreating: boolean;
}): SessionSandboxRestartCandidate | null {
  if (!activeRepoId || !activeSessionSandboxId || !activeSessionSandbox) {
    return null;
  }

  if (sandboxCreating || autoRestartedSandboxId === activeSessionSandboxId) {
    return null;
  }

  const uiState = resolveSandboxUiState({
    session: null,
    record: activeSessionSandbox,
  });
  if (!isSandboxUiStopped(uiState) && !isSandboxUiErrored(uiState)) {
    return null;
  }

  // Stop is an explicit terminal action. Billing-depleted records must also
  // remain terminal so a stale workspace cannot relaunch unfunded compute.
  // The stop store waits for the server response, which supplies this reason,
  // before publishing the stopped record.
  if (blocksImplicitRestart(activeSessionSandbox)) {
    return null;
  }

  return {
    repoId: activeRepoId,
    sessionId: activeSessionId,
    previousSandboxId: activeSessionSandboxId,
    pendingSandboxBranch: activeSessionSandbox.working_branch ?? null,
  };
}
