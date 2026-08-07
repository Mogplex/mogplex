import type { Repo, SandboxRecord } from "@/lib/types";
import type { PaneType, SplitDir } from "@/hooks/use-split-panes";
import { useSessionsStore } from "@/hooks/use-sessions";
import { useSandboxStore } from "@/hooks/use-sandbox";
import { ensureSessionSandboxBinding } from "@/lib/sandbox/session-retarget";
import type { SessionSandboxRestartCandidate } from "@/lib/sandbox/session-auto-restart";
import type { ActiveRepoProps, ActiveSandboxProps } from "./types";

export function buildActiveRepoProps(
  activeRepo: Repo | null,
  activeSandbox: SandboxRecord | null
): ActiveRepoProps | null {
  if (!activeRepo) {
    return null;
  }

  return {
    id: activeRepo.id,
    full_name: activeRepo.full_name,
    root_directory: activeRepo.root_directory,
    default_branch: activeRepo.default_branch,
    working_branch: activeSandbox?.working_branch || null,
  };
}

export function buildActiveSandboxProps(
  activeSandbox: SandboxRecord | null
): ActiveSandboxProps | null {
  return activeSandbox ? { id: activeSandbox.id } : null;
}

export function resetAutoRestartedSandboxRef(
  autoRestartedRef: React.MutableRefObject<string | null>,
  activeSessionSandboxId: string | null
) {
  if (
    autoRestartedRef.current &&
    autoRestartedRef.current !== activeSessionSandboxId
  ) {
    autoRestartedRef.current = null;
  }
}

export async function restartSessionSandboxCandidate(
  candidate: SessionSandboxRestartCandidate,
  autoRestartedRef: React.MutableRefObject<string | null>,
  isCancelled: () => boolean
) {
  const restartedSandbox = await useSandboxStore
    .getState()
    .restart(candidate.repoId, {
      sandboxId: candidate.previousSandboxId,
    });

  if (isCancelled()) return;

  if (!restartedSandbox?.id) {
    if (autoRestartedRef.current === candidate.previousSandboxId) {
      autoRestartedRef.current = null;
    }
    return;
  }

  ensureSessionSandboxBinding(
    candidate.sessionId,
    candidate.previousSandboxId,
    restartedSandbox.id
  );
}

export function hasModifierKey(event: KeyboardEvent) {
  return event.metaKey || event.ctrlKey;
}

export function handleSplitShortcut(
  event: KeyboardEvent,
  activeId: string | null,
  split: (id: string, dir: SplitDir, type: PaneType) => void
) {
  if (!hasModifierKey(event) || event.key !== "\\") {
    return false;
  }

  event.preventDefault();
  if (activeId) {
    split(activeId, "horizontal", "agent");
  }
  return true;
}

export function isEditableShortcutTarget(event: KeyboardEvent) {
  const tag = (event.target as HTMLElement | null)?.tagName;
  return tag === "INPUT" || tag === "TEXTAREA";
}

export function handleCloseShortcut(
  event: KeyboardEvent,
  activeId: string | null,
  paneCount: number,
  closePane: (id: string) => void
) {
  if (!hasModifierKey(event) || event.key !== "w") {
    return false;
  }

  if (isEditableShortcutTarget(event)) {
    return true;
  }

  event.preventDefault();
  if (activeId && paneCount > 1) {
    closePane(activeId);
  }
  return true;
}

export function handleSessionSwitchShortcut(event: KeyboardEvent) {
  if (!hasModifierKey(event) || event.key < "1" || event.key > "9") {
    return false;
  }

  const sessions = useSessionsStore.getState().sessions;
  const index = parseInt(event.key, 10) - 1;
  if (index >= sessions.length) {
    return true;
  }

  event.preventDefault();
  useSessionsStore.getState().switchSession(sessions[index].id);
  return true;
}
