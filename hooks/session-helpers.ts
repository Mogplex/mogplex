import {
  collectPaneIds,
  createDefaultTree,
  findFirstPaneIdByType,
  updatePaneNode,
} from "./use-split-panes";
import type { PaneType, PreviewPaneTab, TreeNode } from "./use-split-panes";
import type { Repo } from "@/lib/types";
import {
  SESSION_COLORS,
  type Session,
  type WorkspaceSessionOptions,
} from "./session-types";

let fallbackIdCounter = 0;

function createClientId() {
  if (typeof crypto?.randomUUID === "function") {
    return crypto.randomUUID();
  }
  fallbackIdCounter += 1;
  const suffix =
    typeof crypto?.getRandomValues === "function"
      ? crypto.getRandomValues(new Uint32Array(2)).join("")
      : fallbackIdCounter.toString(36);
  return `session-${Date.now().toString(36)}-${suffix}`;
}

export function makeSession(index: number, name?: string): Session {
  return {
    id: createClientId(),
    index,
    name: name || `session-${index}`,
    color: SESSION_COLORS[index % SESSION_COLORS.length],
    paneTree: createDefaultTree(),
    activeId: "p-home",
  };
}

export function isWorkspaceSession(
  session: Session | null | undefined
): session is Session & {
  activeRepoId: string;
  activeRepo: Repo;
} {
  return Boolean(session?.activeRepoId && session.activeRepo);
}

export function getPreferredWorkspaceSession(
  sessions: Session[],
  activeSessionId: string
): Session | null {
  const activeSession =
    sessions.find((session) => session.id === activeSessionId) || sessions[0];
  if (isWorkspaceSession(activeSession)) return activeSession;
  return sessions.find((session) => isWorkspaceSession(session)) || null;
}

export function matchesSessionSandbox(
  session: Session,
  repoId: string,
  sandboxId?: string | null,
  pendingSandboxBranch?: string | null
) {
  if (session.activeRepoId !== repoId) return false;
  if (sandboxId) return session.activeSandboxId === sandboxId;
  if (pendingSandboxBranch) {
    return (
      !session.activeSandboxId &&
      session.pendingSandboxBranch === pendingSandboxBranch
    );
  }
  return !session.activeSandboxId;
}

export function getWorkspaceFocusPaneType(options?: {
  previewTab?: PreviewPaneTab;
  focusPaneType?: PaneType;
}) {
  return (
    options?.focusPaneType ?? (options?.previewTab ? "preview" : undefined)
  );
}

export function applyPreviewTabToWorkspaceTree(
  tree: TreeNode,
  previewTab?: PreviewPaneTab
) {
  if (!previewTab) {
    return tree;
  }

  const previewPaneId = findFirstPaneIdByType(tree, "preview");
  return previewPaneId
    ? updatePaneNode(tree, previewPaneId, { previewTab })
    : tree;
}

export function resolveWorkspaceActivePaneId(
  tree: TreeNode,
  focusPaneType?: PaneType
) {
  const fallbackPaneId = collectPaneIds(tree)[0] ?? "p1";
  return focusPaneType
    ? (findFirstPaneIdByType(tree, focusPaneType) ?? fallbackPaneId)
    : fallbackPaneId;
}

export function resolveWorkspaceSessionFocus(
  tree: TreeNode,
  options?: { previewTab?: PreviewPaneTab; focusPaneType?: PaneType }
) {
  const focusPaneType = getWorkspaceFocusPaneType(options);
  const nextTree = applyPreviewTabToWorkspaceTree(tree, options?.previewTab);
  const activeId = resolveWorkspaceActivePaneId(nextTree, focusPaneType);

  return { tree: nextTree, activeId };
}

export function getNextSessionIndex(sessions: Session[]) {
  return sessions.length > 0
    ? Math.max(...sessions.map((session) => session.index)) + 1
    : 0;
}

export function buildWorkspaceSessionName(repo: Repo) {
  const repoShort = repo.full_name.split("/").pop() || repo.full_name;
  return repo.root_directory
    ? `${repoShort}:${repo.root_directory.split("/").pop()}`
    : repoShort;
}

export function deriveWorkspaceSessionSandboxState(
  options?: WorkspaceSessionOptions
) {
  const activeSandboxId = options?.sandboxId ?? null;
  return {
    activeSandboxId,
    pendingSandboxBranch: activeSandboxId
      ? null
      : (options?.pendingSandboxBranch ?? null),
  };
}

export function findExistingWorkspaceSession(
  sessions: Session[],
  repo: Repo,
  options?: WorkspaceSessionOptions
) {
  return sessions.find((session) =>
    matchesSessionSandbox(
      session,
      repo.id,
      options?.sandboxId,
      options?.pendingSandboxBranch
    )
  );
}

export function applyWorkspaceSessionRepoState(
  session: Session,
  repo: Repo,
  options?: WorkspaceSessionOptions
) {
  return {
    ...session,
    activeRepo: repo,
    ...deriveWorkspaceSessionSandboxState(options),
  };
}

export function buildWorkspaceSession(
  repo: Repo,
  sessions: Session[],
  paneTree: TreeNode,
  activeId: string,
  options?: WorkspaceSessionOptions
): Session {
  const nextIndex = getNextSessionIndex(sessions);
  return {
    id: crypto.randomUUID(),
    index: nextIndex,
    name: buildWorkspaceSessionName(repo),
    color: SESSION_COLORS[nextIndex % SESSION_COLORS.length],
    paneTree,
    activeId,
    activeRepoId: repo.id,
    activeRepo: repo,
    ...deriveWorkspaceSessionSandboxState(options),
  };
}

export function normalizeSessionSandboxFields(session: Session) {
  session.activeSandboxId = session.activeSandboxId ?? null;
  session.pendingSandboxBranch = session.pendingSandboxBranch ?? null;
}
