import assert from "node:assert/strict";
import test from "node:test";
import {
  collectPaneIds,
  createDefaultTree,
  createWorkspaceTree,
  detachPane,
  findFirstPaneIdByType,
  insertPaneAt,
  movePane,
  swapPanes,
  type PaneNode,
  type SplitNode,
  type TreeNode,
} from "../../hooks/use-split-panes";

const isSplit = (node: TreeNode): node is SplitNode => "children" in node;
const isPane = (node: TreeNode): node is PaneNode => "type" in node;

function findPane(node: TreeNode, id: string): PaneNode | null {
  if (isPane(node)) return node.id === id ? node : null;
  for (const child of node.children) {
    const result = findPane(child, id);
    if (result) return result;
  }
  return null;
}

function findParent(node: TreeNode, id: string): SplitNode | null {
  if (isPane(node)) return null;
  if (node.children.some((child) => child.id === id)) return node;
  for (const child of node.children) {
    if (isSplit(child)) {
      const result = findParent(child, id);
      if (result) return result;
    }
  }
  return null;
}

test("swapPanes preserves both panes' ids at swapped positions", () => {
  const tree = createWorkspaceTree("acme/repo");
  const agentId = findFirstPaneIdByType(tree, "agent")!;
  const terminalId = findFirstPaneIdByType(tree, "terminal")!;

  const updated = swapPanes(tree, agentId, terminalId);

  // Agent now lives where terminal was; terminal where agent was.
  const agentParent = findParent(updated, agentId);
  const terminalParent = findParent(updated, terminalId);
  assert.ok(agentParent);
  assert.ok(terminalParent);
  // Original tree had agent at root[0], terminal under root[1] (vertical split).
  assert.equal(terminalParent.id, (tree as SplitNode).id);
  assert.equal(
    agentParent.id,
    ((tree as SplitNode).children[1] as SplitNode).id
  );
  // Pane ids unchanged — surrounding pane keys preserved.
  assert.deepEqual(collectPaneIds(updated).sort(), collectPaneIds(tree).sort());
});

test("swapPanes is a noop when both ids match", () => {
  const tree = createWorkspaceTree("acme/repo");
  const agentId = findFirstPaneIdByType(tree, "agent")!;
  const updated = swapPanes(tree, agentId, agentId);
  assert.equal(updated, tree);
});

test("detachPane removes the pane and renormalizes sibling sizes", () => {
  const tree = createWorkspaceTree("acme/repo");
  const previewId = findFirstPaneIdByType(tree, "preview")!;
  const terminalId = findFirstPaneIdByType(tree, "terminal")!;

  const { next, pane } = detachPane(tree, previewId);

  assert.ok(pane);
  assert.equal(pane!.id, previewId);
  assert.ok(next);
  // Right column had [preview, terminal]; collapsing single child should
  // promote terminal up so root.children[1] is now the terminal pane.
  assert.ok(isSplit(next!));
  const right = (next as SplitNode).children[1];
  assert.ok(isPane(right));
  assert.equal((right as PaneNode).id, terminalId);
});

test("detachPane returns next:null when removing the last pane", () => {
  const tree = createDefaultTree();
  const homeId = (tree as PaneNode).id;
  const result = detachPane(tree, homeId);
  assert.equal(result.next, null);
  assert.equal(result.pane!.id, homeId);
});

test("detachPane normalizes sizes when 3+ siblings remain", () => {
  // Build a horizontal split with 3 children manually.
  const tree: SplitNode = {
    id: "s-root",
    dir: "horizontal",
    sizes: [50, 25, 25],
    children: [
      { id: "p-a", type: "agent", name: "A", lines: [], status: "idle" },
      { id: "p-b", type: "tools", name: "B", lines: [], status: "idle" },
      { id: "p-c", type: "files", name: "C", lines: [], status: "idle" },
    ],
  };
  const { next } = detachPane(tree, "p-b");
  assert.ok(next && isSplit(next));
  const split = next as SplitNode;
  assert.equal(split.children.length, 2);
  assert.equal(Math.round(split.sizes.reduce((a, b) => a + b, 0)), 100);
  // Equal redistribution.
  assert.equal(split.sizes[0], 50);
  assert.equal(split.sizes[1], 50);
});

test("insertPaneAt with same-direction parent inserts as sibling and preserves parent split id", () => {
  const tree = createWorkspaceTree("acme/repo");
  const previewId = findFirstPaneIdByType(tree, "preview")!;
  const rightCol = (tree as SplitNode).children[1] as SplitNode;
  const newPane: PaneNode = {
    id: "p-new",
    type: "tools",
    name: "Tools",
    lines: [],
    status: "idle",
  };

  // Right column is vertical; inserting "bottom" (vertical) should be a
  // sibling insert.
  const updated = insertPaneAt(tree, previewId, newPane, "bottom", "s-new");

  const newRight = (updated as SplitNode).children[1] as SplitNode;
  assert.equal(newRight.id, rightCol.id, "parent SplitNode id preserved");
  assert.equal(newRight.children.length, 3);
  // Order: [preview, p-new, terminal]
  assert.equal(newRight.children[0].id, previewId);
  assert.equal(newRight.children[1].id, "p-new");
  assert.equal(Math.round(newRight.sizes.reduce((a, b) => a + b, 0)), 100);
});

test("insertPaneAt with cross-direction wraps the target in a new SplitNode", () => {
  const tree = createWorkspaceTree("acme/repo");
  const previewId = findFirstPaneIdByType(tree, "preview")!;
  const newPane: PaneNode = {
    id: "p-new",
    type: "tools",
    name: "Tools",
    lines: [],
    status: "idle",
  };

  // Right column is vertical; inserting "left" (horizontal) wraps preview.
  const updated = insertPaneAt(tree, previewId, newPane, "left", "s-new");

  // Walk to the wrapper.
  const right = (updated as SplitNode).children[1] as SplitNode;
  const wrapper = right.children[0];
  assert.ok(isSplit(wrapper));
  assert.equal((wrapper as SplitNode).id, "s-new");
  assert.equal((wrapper as SplitNode).dir, "horizontal");
  assert.equal((wrapper as SplitNode).children[0].id, "p-new");
  assert.equal((wrapper as SplitNode).children[1].id, previewId);
});

test("movePane swap routes through swapPanes", () => {
  const tree = createWorkspaceTree("acme/repo");
  const agentId = findFirstPaneIdByType(tree, "agent")!;
  const terminalId = findFirstPaneIdByType(tree, "terminal")!;

  const updated = movePane(tree, agentId, terminalId, "swap");
  // Pane content preserved, positions exchanged.
  assert.deepEqual(collectPaneIds(updated).sort(), collectPaneIds(tree).sort());
  assert.notEqual(
    JSON.stringify(updated),
    JSON.stringify(tree),
    "tree should differ after swap"
  );
});

test("movePane noop when source equals target", () => {
  const tree = createWorkspaceTree("acme/repo");
  const agentId = findFirstPaneIdByType(tree, "agent")!;
  const updated = movePane(tree, agentId, agentId, "right");
  assert.equal(updated, tree);
});

test("movePane noop when only one pane exists", () => {
  const tree = createDefaultTree();
  const homeId = (tree as PaneNode).id;
  const updated = movePane(tree, homeId, homeId, "right");
  assert.equal(updated, tree);
});

test("movePane right with cross-direction parent: detach + wrap", () => {
  // Layout: root(horizontal) = [agent, right(vertical) = [preview, terminal]]
  // Move terminal to the right of agent. Agent's parent is horizontal — same
  // dir as "right" — so terminal becomes a sibling at agent_index + 1.
  const tree = createWorkspaceTree("acme/repo");
  const agentId = findFirstPaneIdByType(tree, "agent")!;
  const terminalId = findFirstPaneIdByType(tree, "terminal")!;
  const rootSplitId = (tree as SplitNode).id;
  const originalRightId = ((tree as SplitNode).children[1] as SplitNode).id;

  const updated = movePane(tree, terminalId, agentId, "right");

  assert.ok(isSplit(updated));
  const root = updated as SplitNode;
  assert.equal(root.id, rootSplitId, "root split id preserved");
  // After detach, terminal's old parent (right column) collapses to single
  // child preview, which gets promoted up — so root now has [agent, terminal,
  // preview] all at the top level (3 horizontal panes).
  assert.equal(root.children.length, 3);
  assert.equal(root.children[0].id, agentId);
  assert.equal(root.children[1].id, terminalId);
  // Third child is the promoted preview pane.
  assert.equal(
    root.children[2].id,
    ((tree as SplitNode).children[1] as SplitNode).children[0].id
  );
  // Old vertical right-col SplitNode is gone.
  const idsAfter = collectPaneIds(updated);
  assert.equal(idsAfter.length, 3);
  // No SplitNode with originalRightId should survive.
  const findSplit = (n: TreeNode): boolean =>
    isSplit(n) && (n.id === originalRightId || n.children.some(findSplit));
  assert.equal(findSplit(updated), false);
});

test("movePane down: terminal moves below agent, wrapping agent in vertical split", () => {
  const tree = createWorkspaceTree("acme/repo");
  const agentId = findFirstPaneIdByType(tree, "agent")!;
  const terminalId = findFirstPaneIdByType(tree, "terminal")!;
  const previewId = findFirstPaneIdByType(tree, "preview")!;

  const updated = movePane(tree, terminalId, agentId, "bottom");

  // Agent's parent (root) is horizontal; "bottom" is vertical → wrap agent
  // in a new vertical SplitNode containing [agent, terminal].
  const root = updated as SplitNode;
  assert.equal(root.dir, "horizontal");
  const left = root.children[0];
  assert.ok(isSplit(left));
  assert.equal((left as SplitNode).dir, "vertical");
  assert.equal((left as SplitNode).children[0].id, agentId);
  assert.equal((left as SplitNode).children[1].id, terminalId);
  // Right column collapsed to single preview pane.
  const right = root.children[1];
  assert.ok(isPane(right));
  assert.equal((right as PaneNode).id, previewId);
});

test("movePane preserves all pane ids (no remount)", () => {
  const tree = createWorkspaceTree("acme/repo");
  const agentId = findFirstPaneIdByType(tree, "agent")!;
  const terminalId = findFirstPaneIdByType(tree, "terminal")!;
  const before = collectPaneIds(tree).sort();

  const updated = movePane(tree, terminalId, agentId, "right");
  const after = collectPaneIds(updated).sort();

  assert.deepEqual(after, before);
  // The moved pane is the same object reference (preserves all fields).
  const movedPane = findPane(updated, terminalId);
  const originalPane = findPane(tree, terminalId);
  assert.ok(movedPane && originalPane);
  assert.equal(movedPane!.type, originalPane!.type);
  assert.equal(movedPane!.name, originalPane!.name);
});
