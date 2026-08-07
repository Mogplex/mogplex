import { findTreeNode } from "./split-panes-tree-ops";
import {
  isPane,
  type MovePosition,
  type PaneNode,
  type SplitDir,
  type SplitNode,
  type TreeNode,
} from "./split-panes-types";

function normalizeSizes(count: number): number[] {
  if (count <= 0) return [];
  const size = 100 / count;
  return Array.from({ length: count }, () => size);
}

/**
 * Removes the pane with `paneId` from the tree and returns the new root plus
 * the detached pane. Single-child SplitNodes collapse into their lone child
 * (mirrors closePane's collapse behavior). Sibling sizes are renormalized so
 * they sum to 100. Returns { next: null } when the pane was the last in the
 * tree, or { pane: null } when the id wasn't found.
 */
export function detachPane(
  root: TreeNode,
  paneId: string
): { next: TreeNode | null; pane: PaneNode | null } {
  let detached: PaneNode | null = null;

  const walk = (node: TreeNode): TreeNode | null => {
    if (isPane(node)) {
      if (node.id === paneId) {
        detached = node;
        return null;
      }
      return node;
    }
    const newChildren: TreeNode[] = [];
    for (const child of node.children) {
      const next = walk(child);
      if (next) newChildren.push(next);
    }
    if (newChildren.length === 0) return null;
    if (newChildren.length === 1) return newChildren[0];
    if (newChildren.length === node.children.length) {
      return { ...node, children: newChildren };
    }
    return {
      ...node,
      children: newChildren,
      sizes: normalizeSizes(newChildren.length),
    };
  };

  const next = walk(root);
  return { next, pane: detached };
}

/**
 * Inserts `pane` adjacent to the pane with `targetId` according to `position`.
 * When the target's parent SplitNode already runs in the requested direction,
 * the new pane becomes a sibling at index +/- 1 -- the parent SplitNode's id
 * (and surrounding panes' React keys) are preserved, matching the invariant
 * in splitTreeAt. Otherwise the target is wrapped in a new SplitNode of the
 * requested direction.
 */
export function insertPaneAt(
  root: TreeNode,
  targetId: string,
  pane: PaneNode,
  position: Exclude<MovePosition, "swap">,
  newSplitId: string
): TreeNode {
  const dir: SplitDir =
    position === "left" || position === "right" ? "horizontal" : "vertical";
  const before = position === "left" || position === "top";

  const wrap = (target: PaneNode): SplitNode => ({
    id: newSplitId,
    dir,
    sizes: [50, 50],
    children: before ? [pane, target] : [target, pane],
  });

  const update = (node: TreeNode): TreeNode => {
    if (isPane(node)) {
      return node.id === targetId ? wrap(node) : node;
    }
    if (node.dir === dir) {
      const idx = node.children.findIndex(
        (child) => isPane(child) && child.id === targetId
      );
      if (idx !== -1) {
        const insertAt = before ? idx : idx + 1;
        const newChildren = [
          ...node.children.slice(0, insertAt),
          pane,
          ...node.children.slice(insertAt),
        ];
        // Give the inserted pane half the target's current size and shrink
        // the target by half -- keeps all other siblings at their current sizes
        // (mirrors splitTreeAt behavior, avoids snapping all panes to equal).
        const targetSize = node.sizes[idx] ?? 100 / node.children.length;
        const half = targetSize / 2;
        const newSizes = [
          ...node.sizes.slice(0, idx),
          half,
          half,
          ...node.sizes.slice(idx + 1),
        ];
        return {
          ...node,
          children: newChildren,
          sizes: newSizes,
        };
      }
    }
    return { ...node, children: node.children.map(update) };
  };

  return update(root);
}

/**
 * Swaps two panes by id. Each pane keeps its own id and content but takes
 * the other's position in the tree. No structural change, no remount of
 * surrounding panes.
 */
export function swapPanes(root: TreeNode, aId: string, bId: string): TreeNode {
  if (aId === bId) return root;

  const find = (node: TreeNode, id: string): PaneNode | null => {
    if (isPane(node)) return node.id === id ? node : null;
    for (const child of node.children) {
      const result = find(child, id);
      if (result) return result;
    }
    return null;
  };

  const a = find(root, aId);
  const b = find(root, bId);
  if (!a || !b) return root;

  const swap = (node: TreeNode): TreeNode => {
    if (isPane(node)) {
      if (node.id === aId) return b;
      if (node.id === bId) return a;
      return node;
    }
    return { ...node, children: node.children.map(swap) };
  };

  return swap(root);
}

/**
 * Moves the pane with `sourceId` next to (or onto) the pane with `targetId`.
 * Returns the original root for noops (same pane, missing ids, last pane).
 */
export function movePane(
  root: TreeNode,
  sourceId: string,
  targetId: string,
  position: MovePosition,
  newSplitId = `s${crypto.randomUUID().slice(0, 8)}`
): TreeNode {
  if (sourceId === targetId) return root;

  if (position === "swap") {
    return swapPanes(root, sourceId, targetId);
  }

  // Verify target exists before detaching the source -- a missing target would
  // silently remove the source pane with nowhere to insert it.
  if (!findTreeNode(root, targetId)) return root;

  const { next, pane } = detachPane(root, sourceId);
  if (!pane || !next) return root;

  return insertPaneAt(next, targetId, pane, position, newSplitId);
}

/**
 * Splits the tree at the target pane, adding a new pane as a sibling or
 * wrapping in a new SplitNode depending on the parent's direction.
 */
export function splitTreeAt(
  root: TreeNode,
  targetId: string,
  dir: SplitDir,
  newPane: PaneNode,
  newSplitId: string
): TreeNode {
  const update = (node: TreeNode): TreeNode => {
    if (isPane(node)) {
      if (node.id === targetId) {
        return {
          id: newSplitId,
          dir,
          sizes: [50, 50],
          children: [node, newPane],
        };
      }
      return node;
    }

    if (node.dir === dir) {
      const idx = node.children.findIndex(
        (child) => isPane(child) && child.id === targetId
      );
      if (idx !== -1) {
        const targetSize = node.sizes[idx] ?? 100 / node.children.length;
        const half = targetSize / 2;
        const newChildren = [
          ...node.children.slice(0, idx + 1),
          newPane,
          ...node.children.slice(idx + 1),
        ];
        const newSizes = [
          ...node.sizes.slice(0, idx),
          half,
          half,
          ...node.sizes.slice(idx + 1),
        ];
        return { ...node, children: newChildren, sizes: newSizes };
      }
    }

    return { ...node, children: node.children.map(update) };
  };
  return update(root);
}

function sizesMatch(current: number[], next: number[]) {
  return (
    current.length === next.length &&
    current.every((size, index) => Math.abs(size - next[index]) < 0.01)
  );
}

export function updateSplitNodeSizes(
  node: TreeNode,
  splitId: string,
  sizes: number[]
): TreeNode {
  if (isPane(node)) {
    return node;
  }

  if (node.id === splitId) {
    return sizesMatch(node.sizes, sizes) ? node : { ...node, sizes };
  }

  const nextChildren = node.children.map((child) =>
    updateSplitNodeSizes(child, splitId, sizes)
  );

  const changed = nextChildren.some(
    (child, index) => child !== node.children[index]
  );
  return changed ? { ...node, children: nextChildren } : node;
}
