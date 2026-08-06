import assert from "node:assert/strict";
import test from "node:test";
import {
  createDefaultTree,
  findFirstPaneIdByType,
} from "../../hooks/use-split-panes";
import type { Repo } from "../../lib/types";

function buildRepo(overrides: Partial<Repo> = {}): Repo {
  return {
    id: "repo-1",
    user_id: "user-1",
    full_name: "acme/demo-app",
    default_branch: "main",
    created_at: "2026-04-04T00:00:00.000Z",
    ...overrides,
  };
}

async function loadSessionsStore() {
  const storage = {
    getItem() {
      return null;
    },
    setItem() {},
    removeItem() {},
    clear() {},
    key() {
      return null;
    },
    length: 0,
  } as Storage;

  globalThis.localStorage = storage;
  const { useSessionsStore } = await import("../../hooks/use-sessions");
  return useSessionsStore;
}

async function resetSessionsStore() {
  const useSessionsStore = await loadSessionsStore();
  useSessionsStore.setState({
    sessions: [
      {
        id: "main-session",
        index: 0,
        name: "main",
        color: "green",
        paneTree: createDefaultTree(),
        activeId: "p-home",
        activeRepo: null,
        activeSandboxId: null,
        pendingSandboxBranch: null,
      },
    ],
    activeSessionId: "main-session",
  });
  return useSessionsStore;
}

test("getPreferredWorkspaceSession falls back to the first workspace session when the active session is blank", async () => {
  const { getPreferredWorkspaceSession } =
    await import("../../hooks/use-sessions");
  const useSessionsStore = await resetSessionsStore();
  const repo = buildRepo();

  const workspaceSessionId = useSessionsStore
    .getState()
    .openWorkspaceSession(repo, {
      sandboxId: "sandbox-123",
    });

  useSessionsStore.getState().createSession("scratch");
  const state = useSessionsStore.getState();
  const preferred = getPreferredWorkspaceSession(
    state.sessions,
    state.activeSessionId
  );

  assert.equal(preferred?.id, workspaceSessionId);
});

test("openWorkspaceSession reuses pending sessions by repo and branch", async () => {
  const useSessionsStore = await resetSessionsStore();
  const repo = buildRepo();

  const firstSessionId = useSessionsStore
    .getState()
    .openWorkspaceSession(repo, {
      pendingSandboxBranch: "feature/watch-build",
    });
  const reusedSessionId = useSessionsStore
    .getState()
    .openWorkspaceSession(repo, {
      pendingSandboxBranch: "feature/watch-build",
    });
  const secondBranchSessionId = useSessionsStore
    .getState()
    .openWorkspaceSession(repo, {
      pendingSandboxBranch: "feature/other-branch",
    });

  assert.equal(reusedSessionId, firstSessionId);
  assert.notEqual(secondBranchSessionId, firstSessionId);
  assert.equal(useSessionsStore.getState().sessions.length, 3);
});

test("setActiveSessionSandbox can target a pending workspace session and clears its pending branch", async () => {
  const useSessionsStore = await resetSessionsStore();
  const repo = buildRepo();

  const pendingSessionId = useSessionsStore
    .getState()
    .openWorkspaceSession(repo, {
      pendingSandboxBranch: "feature/watch-build",
    });
  useSessionsStore.getState().createSession("other");
  const { activeSessionId } = useSessionsStore.getState();

  assert.notEqual(activeSessionId, pendingSessionId);

  useSessionsStore.getState().setActiveSessionSandbox("sandbox-123", {
    sessionId: pendingSessionId,
    replacePaneSandboxIds: true,
  });

  const pendingSession = useSessionsStore
    .getState()
    .sessions.find((session) => session.id === pendingSessionId);
  const otherSession = useSessionsStore
    .getState()
    .sessions.find((session) => session.id === activeSessionId);

  assert.equal(pendingSession?.activeSandboxId, "sandbox-123");
  assert.equal(pendingSession?.pendingSandboxBranch, null);
  assert.equal(otherSession?.activeSandboxId ?? null, null);
  assert.equal(useSessionsStore.getState().activeSessionId, activeSessionId);
});

test("setPendingSessionSandboxBranch clears the bound sandbox and targets a branch", async () => {
  const useSessionsStore = await resetSessionsStore();
  const repo = buildRepo();

  const workspaceSessionId = useSessionsStore
    .getState()
    .openWorkspaceSession(repo, {
      sandboxId: "sandbox-123",
    });
  useSessionsStore.getState().createSession("other");
  const { activeSessionId } = useSessionsStore.getState();

  assert.notEqual(activeSessionId, workspaceSessionId);

  useSessionsStore
    .getState()
    .setPendingSessionSandboxBranch("feature/watch-build", {
      sessionId: workspaceSessionId,
    });

  const pendingSession = useSessionsStore
    .getState()
    .sessions.find((session) => session.id === workspaceSessionId);
  const otherSession = useSessionsStore
    .getState()
    .sessions.find((session) => session.id === activeSessionId);

  assert.equal(pendingSession?.activeSandboxId, null);
  assert.equal(pendingSession?.pendingSandboxBranch, "feature/watch-build");
  assert.equal(otherSession?.activeSandboxId ?? null, null);
  assert.equal(useSessionsStore.getState().activeSessionId, activeSessionId);
});

test("updatePaneTree can flush a specific inactive workspace session", async () => {
  const useSessionsStore = await resetSessionsStore();
  const workspaceSessionId = useSessionsStore
    .getState()
    .openWorkspaceSession(buildRepo());
  useSessionsStore.getState().createSession("other");
  const { activeSessionId } = useSessionsStore.getState();
  const flushedTree = {
    ...createDefaultTree(),
    name: "Flushed workspace tree",
  };

  useSessionsStore.getState().updatePaneTree(flushedTree, "p-home", {
    sessionId: workspaceSessionId,
  });

  const state = useSessionsStore.getState();
  const workspaceSession = state.sessions.find(
    (session) => session.id === workspaceSessionId
  );
  const activeSession = state.sessions.find(
    (session) => session.id === activeSessionId
  );

  assert.equal(workspaceSession?.paneTree, flushedTree);
  assert.notEqual(activeSession?.paneTree, flushedTree);
  assert.equal(state.activeSessionId, activeSessionId);
});

test("resetSessionLayout preserves repo context for workspace sessions", async () => {
  const useSessionsStore = await resetSessionsStore();
  const repo = buildRepo({ root_directory: "apps/web" });

  const workspaceSessionId = useSessionsStore
    .getState()
    .openWorkspaceSession(repo, {
      sandboxId: "sandbox-123",
    });

  useSessionsStore.getState().resetSessionLayout(workspaceSessionId);

  const workspaceSession = useSessionsStore
    .getState()
    .sessions.find((session) => session.id === workspaceSessionId);

  assert.equal(workspaceSession?.activeRepoId, repo.id);
  assert.equal(workspaceSession?.activeRepo?.full_name, repo.full_name);
  assert.equal(workspaceSession?.activeSandboxId, "sandbox-123");
  assert.notEqual(workspaceSession?.activeId, "p-home");
  assert.ok(workspaceSession);
  assert.notEqual(
    findFirstPaneIdByType(workspaceSession.paneTree, "agent"),
    null
  );
  assert.notEqual(
    findFirstPaneIdByType(workspaceSession.paneTree, "preview"),
    null
  );
  assert.notEqual(
    findFirstPaneIdByType(workspaceSession.paneTree, "terminal"),
    null
  );
});
