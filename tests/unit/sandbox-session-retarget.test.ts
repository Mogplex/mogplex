import assert from "node:assert/strict";
import test from "node:test";
import {
  createWorkspaceTree,
  findFirstPaneIdByType,
  updatePaneNode,
} from "../../hooks/use-split-panes";
import type { TreeNode } from "../../hooks/use-split-panes";
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

function findPaneById(
  node: TreeNode,
  paneId: string
): { id: string; sandboxId?: string; sandboxBinding?: string } | null {
  if ("type" in node) {
    return node.id === paneId ? node : null;
  }

  for (const child of node.children) {
    const found = findPaneById(child, paneId);
    if (found) return found;
  }

  return null;
}

async function loadStores() {
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
  const { useConversationsStore } =
    await import("../../hooks/use-conversations");
  const {
    bindSessionToPendingSandboxBranch,
    ensureSessionSandboxBinding,
    retargetSessionToSandbox,
  } = await import("../../lib/sandbox/session-retarget");

  useSessionsStore.setState({
    sessions: [],
    activeSessionId: "",
  });
  useConversationsStore.setState({
    conversations: {},
    conversationList: [],
    userId: null,
    defaultModel: "minimax/minimax-m2.5",
  });

  return {
    bindSessionToPendingSandboxBranch,
    ensureSessionSandboxBinding,
    useSessionsStore,
    useConversationsStore,
    retargetSessionToSandbox,
  };
}

type LoadedStores = Awaited<ReturnType<typeof loadStores>>;

function createBoundSandboxWorkspace(
  useSessionsStore: LoadedStores["useSessionsStore"],
  repo: Repo,
  sandboxId: string
) {
  const baseTree = createWorkspaceTree(repo.full_name, null);
  const agentPaneId = findFirstPaneIdByType(baseTree, "agent");
  const previewPaneId = findFirstPaneIdByType(baseTree, "preview");

  assert.ok(agentPaneId);
  assert.ok(previewPaneId);

  const paneTree = updatePaneNode(
    updatePaneNode(baseTree, agentPaneId, { sandboxId }),
    previewPaneId,
    { sandboxId }
  );
  const sessionId = useSessionsStore
    .getState()
    .createWorkspaceSession(repo, paneTree, { sandboxId });

  return {
    agentPaneId,
    previewPaneId,
    sessionId,
  };
}

function seedHarnessConversation(
  useConversationsStore: LoadedStores["useConversationsStore"],
  paneId: string,
  sandboxId: string
) {
  useConversationsStore.setState({
    conversations: {
      [paneId]: {
        messages: [],
        localMsgs: [],
        harnessState: {
          "claude-code": {
            sessionId: "claude-session-1",
            sandboxId,
          },
        },
        model: "harness:claude-code",
        mode: "AUTO",
        updatedAt: null,
      },
    },
  });
}

function readSessionSandboxState(
  useSessionsStore: LoadedStores["useSessionsStore"],
  sessionId: string,
  agentPaneId: string,
  previewPaneId: string
) {
  const session = useSessionsStore
    .getState()
    .sessions.find((candidate) => candidate.id === sessionId);

  return {
    session,
    agentPane: session ? findPaneById(session.paneTree, agentPaneId) : null,
    previewPane: session ? findPaneById(session.paneTree, previewPaneId) : null,
  };
}

test("retargetSessionToSandbox updates pane bindings and harness sandbox state", async () => {
  const { useSessionsStore, useConversationsStore, retargetSessionToSandbox } =
    await loadStores();
  const repo = buildRepo();
  const { agentPaneId, previewPaneId, sessionId } = createBoundSandboxWorkspace(
    useSessionsStore,
    repo,
    "sandbox-a"
  );
  seedHarnessConversation(useConversationsStore, agentPaneId, "sandbox-a");

  const changed = retargetSessionToSandbox(sessionId, "sandbox-a", "sandbox-b");
  const { session, agentPane, previewPane } = readSessionSandboxState(
    useSessionsStore,
    sessionId,
    agentPaneId,
    previewPaneId
  );
  const conversation =
    useConversationsStore.getState().conversations[agentPaneId];

  assert.equal(changed, true);
  assert.equal(session?.activeSandboxId, "sandbox-b");
  assert.equal(agentPane?.sandboxBinding, "session");
  assert.equal(previewPane?.sandboxBinding, "session");
  assert.equal(agentPane?.sandboxId, undefined);
  assert.equal(previewPane?.sandboxId, undefined);
  assert.equal(
    conversation?.harnessState["claude-code"]?.sandboxId,
    "sandbox-b"
  );
});

test("ensureSessionSandboxBinding binds preview panes when launching a sandbox from a session without a prior sandbox", async () => {
  const { ensureSessionSandboxBinding, useSessionsStore } = await loadStores();
  const repo = buildRepo();
  const tree = createWorkspaceTree(repo.full_name, null);
  const sessionId = useSessionsStore
    .getState()
    .createWorkspaceSession(repo, tree, {
      sandboxId: undefined,
    });
  const previewPaneId = findFirstPaneIdByType(tree, "preview");

  assert.ok(previewPaneId);

  const changed = ensureSessionSandboxBinding(sessionId, null, "sandbox-new");
  const session = useSessionsStore
    .getState()
    .sessions.find((candidate) => candidate.id === sessionId);
  const previewPane = session
    ? findPaneById(session.paneTree, previewPaneId!)
    : null;

  assert.equal(changed, true);
  assert.equal(session?.activeSandboxId, "sandbox-new");
  assert.equal(previewPane?.sandboxId, undefined);
});

test("ensureSessionSandboxBinding preserves pane retargeting after restart pre-clears the session sandbox binding", async () => {
  const {
    bindSessionToPendingSandboxBranch,
    ensureSessionSandboxBinding,
    useConversationsStore,
    useSessionsStore,
  } = await loadStores();
  const repo = buildRepo();
  const { agentPaneId, previewPaneId, sessionId } = createBoundSandboxWorkspace(
    useSessionsStore,
    repo,
    "sandbox-a"
  );
  seedHarnessConversation(useConversationsStore, agentPaneId, "sandbox-a");

  bindSessionToPendingSandboxBranch(sessionId, "feature/restart");
  const changed = ensureSessionSandboxBinding(
    sessionId,
    "sandbox-a",
    "sandbox-b"
  );
  const { session, agentPane, previewPane } = readSessionSandboxState(
    useSessionsStore,
    sessionId,
    agentPaneId,
    previewPaneId
  );
  const conversation =
    useConversationsStore.getState().conversations[agentPaneId];

  assert.equal(changed, true);
  assert.equal(session?.activeSandboxId, "sandbox-b");
  assert.equal(session?.pendingSandboxBranch, null);
  assert.equal(agentPane?.sandboxBinding, "session");
  assert.equal(previewPane?.sandboxBinding, "session");
  assert.equal(agentPane?.sandboxId, undefined);
  assert.equal(previewPane?.sandboxId, undefined);
  assert.equal(
    conversation?.harnessState["claude-code"]?.sandboxId,
    "sandbox-b"
  );
});
