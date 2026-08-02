"use client";
import { useSyncExternalStore } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  createDefaultTree,
  collectPaneIds,
  createWorkspaceTree,
  findFirstPaneIdByType,
  retargetSandboxPanes,
  updatePaneNode,
} from "./use-split-panes";
import type { PaneType, PreviewPaneTab, TreeNode } from "./use-split-panes";
import type { Repo } from "@/lib/types";

const SESSION_COLORS = [
  "green",
  "blue",
  "amber",
  "violet",
  "cyan",
  "rose",
  "orange",
  "teal",
] as const;
type SessionColor = (typeof SESSION_COLORS)[number];

export type Session = {
  id: string;
  index: number;
  name: string;
  color: SessionColor;
  paneTree: TreeNode;
  activeId: string;
  activeRepoId?: string;
  activeRepo?: Repo | null;
  activeSandboxId?: string | null;
  pendingSandboxBranch?: string | null;
};

type WorkspaceSessionOptions = {
  previewTab?: PreviewPaneTab;
  focusPaneType?: PaneType;
  sandboxId?: string | null;
  pendingSandboxBranch?: string | null;
};

type SessionsState = {
  sessions: Session[];
  activeSessionId: string;
  createSession: (name?: string) => void;
  createWorkspaceSession: (
    repo: Repo,
    tree: TreeNode,
    options?: WorkspaceSessionOptions
  ) => string;
  openWorkspaceSession: (
    repo: Repo,
    options?: WorkspaceSessionOptions
  ) => string;
  setPendingSessionSandboxBranch: (
    pendingSandboxBranch: string | null,
    options?: { sessionId?: string | null }
  ) => void;
  setActiveSessionSandbox: (
    sandboxId: string | null,
    options?: {
      previousSandboxId?: string | null;
      replacePaneSandboxIds?: boolean;
      sessionId?: string | null;
    }
  ) => void;
  closeSession: (id: string) => void;
  switchSession: (id: string) => void;
  renameSession: (id: string, name: string) => void;
  resetSessionLayout: (id: string) => void;
  updatePaneTree: (tree: TreeNode, activeId: string) => void;
  getActiveSession: () => Session;
};

function makeSession(index: number, name?: string): Session {
  return {
    id: crypto.randomUUID(),
    index,
    name: name || `session-${index}`,
    color: SESSION_COLORS[index % SESSION_COLORS.length],
    paneTree: createDefaultTree(),
    activeId: "p-home",
  };
}

const initialSession = makeSession(0, "main");

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

function matchesSessionSandbox(
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

function getWorkspaceFocusPaneType(options?: {
  previewTab?: PreviewPaneTab;
  focusPaneType?: PaneType;
}) {
  return (
    options?.focusPaneType ?? (options?.previewTab ? "preview" : undefined)
  );
}

function applyPreviewTabToWorkspaceTree(
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

function resolveWorkspaceActivePaneId(
  tree: TreeNode,
  focusPaneType?: PaneType
) {
  const fallbackPaneId = collectPaneIds(tree)[0] ?? "p1";
  return focusPaneType
    ? (findFirstPaneIdByType(tree, focusPaneType) ?? fallbackPaneId)
    : fallbackPaneId;
}

function resolveWorkspaceSessionFocus(
  tree: TreeNode,
  options?: { previewTab?: PreviewPaneTab; focusPaneType?: PaneType }
) {
  const focusPaneType = getWorkspaceFocusPaneType(options);
  const nextTree = applyPreviewTabToWorkspaceTree(tree, options?.previewTab);
  const activeId = resolveWorkspaceActivePaneId(nextTree, focusPaneType);

  return { tree: nextTree, activeId };
}

function getNextSessionIndex(sessions: Session[]) {
  return sessions.length > 0
    ? Math.max(...sessions.map((session) => session.index)) + 1
    : 0;
}

function buildWorkspaceSessionName(repo: Repo) {
  const repoShort = repo.full_name.split("/").pop() || repo.full_name;
  return repo.root_directory
    ? `${repoShort}:${repo.root_directory.split("/").pop()}`
    : repoShort;
}

function deriveWorkspaceSessionSandboxState(options?: WorkspaceSessionOptions) {
  const activeSandboxId = options?.sandboxId ?? null;
  return {
    activeSandboxId,
    pendingSandboxBranch: activeSandboxId
      ? null
      : (options?.pendingSandboxBranch ?? null),
  };
}

function findExistingWorkspaceSession(
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

function applyWorkspaceSessionRepoState(
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

function buildWorkspaceSession(
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

type PersistedSessionsState = {
  sessions: Session[];
  activeSessionId: string;
};

function normalizeSessionSandboxFields(session: Session) {
  session.activeSandboxId = session.activeSandboxId ?? null;
  session.pendingSandboxBranch = session.pendingSandboxBranch ?? null;
}

function migratePersistedSessionsV0(state: PersistedSessionsState) {
  for (const session of state.sessions) {
    if (!session.activeRepoId) {
      session.paneTree = createDefaultTree();
      session.activeId = "p-home";
    }
    normalizeSessionSandboxFields(session);
  }

  return state;
}

function migratePersistedSessionsV1(state: PersistedSessionsState) {
  for (const session of state.sessions) {
    normalizeSessionSandboxFields(session);
  }

  return state;
}

function migratePersistedSessionsV2(state: PersistedSessionsState) {
  for (const session of state.sessions) {
    session.pendingSandboxBranch = session.pendingSandboxBranch ?? null;
  }

  return state;
}

export const useSessionsStore = create<SessionsState>()(
  persist(
    (set, get) => ({
      sessions: [initialSession],
      activeSessionId: initialSession.id,

      createSession: (name?: string) => {
        const { sessions } = get();
        const nextIndex =
          sessions.length > 0
            ? Math.max(...sessions.map((s) => s.index)) + 1
            : 0;
        const session = makeSession(nextIndex, name || `session-${nextIndex}`);
        set({
          sessions: [...sessions, session],
          activeSessionId: session.id,
        });
      },

      createWorkspaceSession: (repo: Repo, tree: TreeNode, options) => {
        const { sessions } = get();
        const existing = findExistingWorkspaceSession(sessions, repo, options);
        if (existing) {
          set((s) => ({
            activeSessionId: existing.id,
            sessions: s.sessions.map((sess) =>
              sess.id === existing.id
                ? applyWorkspaceSessionRepoState(sess, repo, options)
                : sess
            ),
          }));
          return existing.id;
        }
        const session = buildWorkspaceSession(
          repo,
          sessions,
          tree,
          collectPaneIds(tree)[0] || "p1",
          options
        );
        set({
          sessions: [...sessions, session],
          activeSessionId: session.id,
        });
        return session.id;
      },

      openWorkspaceSession: (repo, options) => {
        const { sessions } = get();
        const existing = findExistingWorkspaceSession(sessions, repo, options);

        if (existing) {
          const focused = resolveWorkspaceSessionFocus(
            existing.paneTree,
            options
          );
          set((state) => ({
            activeSessionId: existing.id,
            sessions: state.sessions.map((session) =>
              session.id === existing.id
                ? {
                    ...applyWorkspaceSessionRepoState(session, repo, options),
                    paneTree: focused.tree,
                    activeId: focused.activeId,
                  }
                : session
            ),
          }));
          return existing.id;
        }

        const tree = createWorkspaceTree(repo.full_name, repo.root_directory, {
          previewTab: options?.previewTab,
          sandboxId: options?.sandboxId,
        });
        const focused = resolveWorkspaceSessionFocus(tree, options);
        const session = buildWorkspaceSession(
          repo,
          sessions,
          focused.tree,
          focused.activeId,
          options
        );
        set({
          sessions: [...sessions, session],
          activeSessionId: session.id,
        });
        return session.id;
      },

      setPendingSessionSandboxBranch: (pendingSandboxBranch, options) => {
        set((state) => ({
          sessions: state.sessions.map((session) =>
            session.id === (options?.sessionId ?? state.activeSessionId)
              ? {
                  ...session,
                  activeSandboxId: null,
                  pendingSandboxBranch,
                }
              : session
          ),
        }));
      },

      setActiveSessionSandbox: (sandboxId, options) => {
        set((state) => ({
          sessions: state.sessions.map((session) =>
            session.id === (options?.sessionId ?? state.activeSessionId)
              ? {
                  ...session,
                  activeSandboxId: sandboxId,
                  pendingSandboxBranch: sandboxId
                    ? null
                    : (session.pendingSandboxBranch ?? null),
                  paneTree: options?.replacePaneSandboxIds
                    ? retargetSandboxPanes(
                        session.paneTree,
                        options?.previousSandboxId ?? session.activeSandboxId,
                        sandboxId
                      )
                    : session.paneTree,
                }
              : session
          ),
        }));
      },

      closeSession: (id: string) => {
        const { sessions, activeSessionId } = get();
        if (sessions.length <= 1) return;
        const filtered = sessions.filter((s) => s.id !== id);
        const fallbackActiveId =
          activeSessionId === id
            ? filtered[
                Math.min(
                  sessions.findIndex((s) => s.id === id),
                  filtered.length - 1
                )
              ]?.id
            : activeSessionId;
        const preferredWorkspaceSession = fallbackActiveId
          ? getPreferredWorkspaceSession(filtered, fallbackActiveId)
          : null;
        const newActive = preferredWorkspaceSession?.id || fallbackActiveId;
        if (!newActive) return;
        set({ sessions: filtered, activeSessionId: newActive });
      },

      switchSession: (id: string) => {
        set({ activeSessionId: id });
      },

      renameSession: (id: string, name: string) => {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === id ? { ...s, name } : s
          ),
        }));
      },

      resetSessionLayout: (id: string) => {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === id
              ? (() => {
                  if (!isWorkspaceSession(s)) {
                    return {
                      ...s,
                      paneTree: createDefaultTree(),
                      activeId: "p-home",
                      activeRepoId: undefined,
                      activeRepo: null,
                      activeSandboxId: null,
                      pendingSandboxBranch: null,
                    };
                  }

                  const paneTree = createWorkspaceTree(
                    s.activeRepo.full_name,
                    s.activeRepo.root_directory,
                    {
                      sandboxId: s.activeSandboxId,
                    }
                  );

                  return {
                    ...s,
                    paneTree,
                    activeId: collectPaneIds(paneTree)[0] || "p1",
                    activeRepoId: s.activeRepo.id,
                    activeRepo: s.activeRepo,
                    activeSandboxId: s.activeSandboxId ?? null,
                    pendingSandboxBranch: s.pendingSandboxBranch ?? null,
                  };
                })()
              : s
          ),
        }));
      },

      updatePaneTree: (tree: TreeNode, activeId: string) => {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === state.activeSessionId
              ? { ...s, paneTree: tree, activeId }
              : s
          ),
        }));
      },

      getActiveSession: () => {
        const { sessions, activeSessionId } = get();
        return sessions.find((s) => s.id === activeSessionId) || sessions[0];
      },
    }),
    {
      name: "mogplex-sessions",
      version: 3,
      migrate: (persisted: unknown, version: number) => {
        if (version === 0) {
          return migratePersistedSessionsV0(
            persisted as PersistedSessionsState
          );
        }

        if (version === 1) {
          return migratePersistedSessionsV1(
            persisted as PersistedSessionsState
          );
        }

        if (version === 2) {
          return migratePersistedSessionsV2(
            persisted as PersistedSessionsState
          );
        }
        return persisted as PersistedSessionsState;
      },
      partialize: (state) => ({
        sessions: state.sessions,
        activeSessionId: state.activeSessionId,
      }),
    }
  )
);

export function useSessionsHydrated() {
  return useSyncExternalStore(
    (onStoreChange) => {
      const persistApi = useSessionsStore.persist;
      if (!persistApi) return () => {};

      const unsubscribeHydrate = persistApi.onHydrate(onStoreChange);
      const unsubscribeFinishHydration =
        persistApi.onFinishHydration(onStoreChange);

      return () => {
        unsubscribeHydrate();
        unsubscribeFinishHydration();
      };
    },
    () => useSessionsStore.persist?.hasHydrated?.() ?? true,
    () => false
  );
}
