import { createDefaultTree } from "./use-split-panes";
import { normalizeSessionSandboxFields } from "./session-helpers";
import type { PersistedSessionsState } from "./session-types";

export function migratePersistedSessionsV0(state: PersistedSessionsState) {
  for (const session of state.sessions) {
    if (!session.activeRepoId) {
      session.paneTree = createDefaultTree();
      session.activeId = "p-home";
    }
    normalizeSessionSandboxFields(session);
  }

  return state;
}

export function migratePersistedSessionsV1(state: PersistedSessionsState) {
  for (const session of state.sessions) {
    normalizeSessionSandboxFields(session);
  }

  return state;
}

export function migratePersistedSessionsV2(state: PersistedSessionsState) {
  for (const session of state.sessions) {
    session.pendingSandboxBranch = session.pendingSandboxBranch ?? null;
  }

  return state;
}
