import assert from "node:assert/strict";
import test from "node:test";
import {
  collectTerminalSessions,
  createDefaultTree,
  createPaneNode,
  createTerminalSessionKey,
  createWorkspaceTree,
  findFirstPaneIdByType,
  splitTreeAt,
  updatePaneNode,
  retargetSandboxPanes,
  type SplitNode,
  type TreeNode,
} from "../../hooks/use-split-panes";

const isSplit = (node: TreeNode): node is SplitNode => "children" in node;

test("createPaneNode numbers additional terminal panes", () => {
  const tree = createWorkspaceTree("acme/repo");
  const pane = createPaneNode(tree, "p-terminal-2", "terminal", {
    sandboxId: "sandbox-123",
  });

  assert.equal(pane.name, "Terminal 2");
  assert.equal(pane.status, "idle");
  assert.equal(pane.sandboxBinding, "session");
  assert.equal(pane.sandboxId, "sandbox-123");
  assert.equal(pane.terminalSessionKey, "p-terminal-2");
});

test("createPaneNode keeps the default terminal name when none exist yet", () => {
  const tree = createDefaultTree();
  const pane = createPaneNode(tree, "p-terminal-1", "terminal");

  assert.equal(pane.name, "Terminal");
});

test("collectTerminalSessions groups panes attached to the same session", () => {
  const tree = createWorkspaceTree("acme/repo");
  const attachedSessionKey = createTerminalSessionKey();
  const firstAttached = createPaneNode(tree, "p-terminal-a", "terminal", {
    name: "Shared Session",
    terminalSessionKey: attachedSessionKey,
    sandboxBinding: "pinned",
    sandboxId: "sandbox-shared",
  });
  const secondAttached = createPaneNode(tree, "p-terminal-b", "terminal", {
    name: "Shared Session",
    terminalSessionKey: attachedSessionKey,
    sandboxBinding: "pinned",
    sandboxId: "sandbox-shared",
  });

  const grouped = collectTerminalSessions({
    id: "s-test",
    dir: "horizontal",
    sizes: [34, 33, 33],
    children: [tree, firstAttached, secondAttached],
  });

  const shared = grouped.find(
    (session) => session.terminalSessionKey === attachedSessionKey
  );
  assert.ok(shared);
  assert.equal(shared.name, "Shared Session");
  assert.deepEqual(shared.paneIds.sort(), ["p-terminal-a", "p-terminal-b"]);
  assert.equal(shared.sandboxBinding, "pinned");
  assert.equal(shared.sandboxId, "sandbox-shared");
});

test("retargetSandboxPanes clears stale pane sandbox IDs for session-bound workspace panes", () => {
  const tree = createWorkspaceTree("acme/repo", null);
  const previewPaneId = findFirstPaneIdByType(tree, "preview");
  assert.ok(previewPaneId);

  const updatedTree = updatePaneNode(tree, previewPaneId!, {
    sandboxId: "sandbox-old",
  });
  const updated = retargetSandboxPanes(
    updatedTree,
    "sandbox-old",
    "sandbox-new"
  );

  const serialized = JSON.stringify(updated);
  assert.doesNotMatch(serialized, /sandbox-old/);
  assert.doesNotMatch(serialized, /sandbox-new/);
});

test("splitTreeAt inserts as sibling when parent split direction matches", () => {
  // workspace tree right column is a vertical SplitNode containing preview + terminal.
  const tree = createWorkspaceTree("acme/repo");
  const terminalId = findFirstPaneIdByType(tree, "terminal");
  assert.ok(terminalId);

  const newPane = createPaneNode(tree, "p-new", "terminal");
  const updated = splitTreeAt(tree, terminalId!, "vertical", newPane, "s-new");

  assert.ok(isSplit(updated));
  // root split unchanged
  assert.equal(updated.id, tree.id);
  // find the parent split that contained the original terminal
  const rightCol = updated.children[1];
  assert.ok(isSplit(rightCol));
  // parent split id MUST be preserved (no remount)
  const originalRightCol = (tree as SplitNode).children[1] as SplitNode;
  assert.equal(rightCol.id, originalRightCol.id);
  // children grew by one and the original terminal kept its id at index 1
  assert.equal(rightCol.children.length, 3);
  assert.equal(rightCol.children[1].id, terminalId);
  assert.equal(rightCol.children[2].id, "p-new");
  // sizes grew correspondingly and sum to 100
  assert.equal(rightCol.sizes.length, 3);
  assert.equal(Math.round(rightCol.sizes.reduce((a, b) => a + b, 0)), 100);
});

test("splitTreeAt wraps when parent split direction differs", () => {
  // workspace right column is vertical; splitting the terminal horizontally
  // must wrap (no same-direction parent to extend).
  const tree = createWorkspaceTree("acme/repo");
  const terminalId = findFirstPaneIdByType(tree, "terminal");
  assert.ok(terminalId);

  const newPane = createPaneNode(tree, "p-new", "terminal");
  const updated = splitTreeAt(
    tree,
    terminalId!,
    "horizontal",
    newPane,
    "s-wrap"
  );

  assert.ok(isSplit(updated));
  const rightCol = updated.children[1] as SplitNode;
  // the terminal slot should now hold a new horizontal SplitNode wrapper
  const wrapped = rightCol.children[1];
  assert.ok(isSplit(wrapped));
  assert.equal(wrapped.id, "s-wrap");
  assert.equal(wrapped.dir, "horizontal");
  assert.equal(wrapped.children.length, 2);
  assert.equal(wrapped.children[0].id, terminalId);
  assert.equal(wrapped.children[1].id, "p-new");
});

test("splitTreeAt wraps when target is the root pane", () => {
  const tree = createDefaultTree();
  const newPane = createPaneNode(tree, "p-new", "terminal");
  const updated = splitTreeAt(tree, tree.id, "vertical", newPane, "s-root");

  assert.ok(isSplit(updated));
  assert.equal(updated.id, "s-root");
  assert.equal(updated.children.length, 2);
  assert.equal(updated.children[0].id, tree.id);
  assert.equal(updated.children[1].id, "p-new");
});

test("retargetSandboxPanes preserves pinned pane overrides", () => {
  const tree = createWorkspaceTree("acme/repo", null, {
    sandboxId: "sandbox-old",
  });
  const previewPaneId = findFirstPaneIdByType(tree, "preview");
  assert.ok(previewPaneId);

  const updatedTree = updatePaneNode(tree, previewPaneId!, {
    sandboxBinding: "pinned",
    sandboxId: "sandbox-old",
  });
  const updated = retargetSandboxPanes(
    updatedTree,
    "sandbox-old",
    "sandbox-new"
  );

  const serialized = JSON.stringify(updated);
  assert.match(serialized, /sandbox-new/);
  assert.doesNotMatch(serialized, /sandbox-old/);
});
