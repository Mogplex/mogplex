"use client";
import { useSyncExternalStore } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Repo } from "@/lib/types";
import type { PersistedSessionsState, SessionsState } from "./session-types";
import {
  applyWorkspaceSessionRepoState,
  buildWorkspaceSession,
  findExistingWorkspaceSession,
  getPreferredWorkspaceSession,
  isWorkspaceSession,
  makeSession,
  resolveWorkspaceSessionFocus,
} from "./session-helpers";
import {
  migratePersistedSessionsV0,
  migratePersistedSessionsV1,
  migratePersistedSessionsV2,
} from "./session-migrations";
import {
  collectPaneIds,
  createDefaultTree,
  createWorkspaceTree,
  retargetSandboxPanes,
} from "./use-split-panes";

export type {
  Session,
  SessionColor,
  WorkspaceSessionOptions,
} from "./session-types";
export { SESSION_COLORS } from "./session-types";
export {
  getPreferredWorkspaceSession,
  isWorkspaceSession,
} from "./session-helpers";

const initialSession = makeSession(0, "main");

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

      createWorkspaceSession: (repo: Repo, tree, options) => {
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

      updatePaneTree: (tree, activeId, options) => {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === (options?.sessionId ?? state.activeSessionId)
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
