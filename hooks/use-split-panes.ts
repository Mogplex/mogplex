"use client";
import { useState, useCallback } from "react";
import {
  getTreePathBasename,
  matchesTreePathTarget,
  retargetTreePath,
  stripDirectoryTreePath,
} from "@/lib/file-tree-paths";

export type PaneType =
  | "home"
  | "agent"
  | "tools"
  | "memories"
  | "rules"
  | "skills"
  | "terminal"
  | "editor"
  | "stats"
  | "files"
  | "preview"
  | "roster"
  | "output"
  | "cron"
  | "diff"
  | "triggers"
  | "connections";
export type SplitDir = "horizontal" | "vertical";
export type PreviewPaneTab = "preview" | "code" | "health";
export type PaneSandboxBinding = "session" | "pinned";

export type PaneNode = {
  id: string;
  type: PaneType;
  name: string;
  lines: string[];
  status: "idle" | "running" | "done";
  sandboxBinding?: PaneSandboxBinding;
  sandboxId?: string; // DB sandbox record ID
  sandboxVid?: string; // Vercel sandbox ID (sb_xxx)
  terminalSessionKey?: string; // Stable tmux-backed terminal identity
  filePath?: string; // For editor panes and preview code tab selection
  previewTab?: PreviewPaneTab;
};

type FilePathMutationScope = {
  targetSandboxId?: string | null;
  activeSessionSandboxId?: string | null;
};

export type TerminalSessionSummary = {
  terminalSessionKey: string;
  name: string;
  paneIds: string[];
  sandboxBinding?: PaneSandboxBinding;
  sandboxId?: string;
};

export type SplitNode = {
  id: string;
  dir: SplitDir;
  children: (PaneNode | SplitNode)[];
  sizes: number[];
};

export type TreeNode = PaneNode | SplitNode;

const isPane = (n: TreeNode): n is PaneNode => "type" in n;

const DEFAULT_PANE_NAMES: Record<PaneType, string> = {
  home: "Workspace Guide",
  agent: "Agent Chat",
  tools: "Tools",
  memories: "Context",
  rules: "Rules",
  skills: "Skills",
  terminal: "Terminal",
  editor: "Code Editor",
  stats: "Stats",
  files: "Project Files",
  preview: "Live Preview",
  roster: "Agents",
  output: "Output",
  cron: "Scheduled Runs",
  diff: "Diff",
  triggers: "Workflows",
  connections: "Connections",
};

const SESSION_BOUND_PANE_TYPES = new Set<PaneType>([
  "agent",
  "terminal",
  "editor",
  "files",
  "preview",
]);

export function getPaneSandboxBinding(
  pane:
    | Pick<PaneNode, "type" | "sandboxBinding">
    | { type: PaneType; sandboxBinding?: PaneSandboxBinding }
): PaneSandboxBinding | undefined {
  if (pane.sandboxBinding) return pane.sandboxBinding;
  return SESSION_BOUND_PANE_TYPES.has(pane.type) ? "session" : undefined;
}

function buildDefaultPaneName(node: TreeNode, type: PaneType) {
  if (type !== "terminal") {
    return DEFAULT_PANE_NAMES[type];
  }

  const existingTerminalCount = collectPanes(node).filter(
    (pane) => pane.type === "terminal"
  ).length;
  return existingTerminalCount === 0
    ? DEFAULT_PANE_NAMES.terminal
    : `${DEFAULT_PANE_NAMES.terminal} ${existingTerminalCount + 1}`;
}

export function createPaneNode(
  node: TreeNode,
  id: string,
  type: PaneType,
  overrides: Partial<PaneNode> = {}
): PaneNode {
  const pane: PaneNode = {
    id,
    type,
    name: overrides.name ?? buildDefaultPaneName(node, type),
    lines: [],
    status: "idle",
    sandboxBinding: overrides.sandboxBinding ?? getPaneSandboxBinding({ type }),
    ...overrides,
  };

  if (type === "terminal") {
    pane.terminalSessionKey = overrides.terminalSessionKey ?? id;
  }

  return pane;
}

export function getTerminalSessionKey(
  pane:
    | Pick<PaneNode, "id" | "type" | "terminalSessionKey">
    | { id: string; type: PaneType; terminalSessionKey?: string }
) {
  return pane.terminalSessionKey ?? pane.id;
}

export function createTerminalSessionKey() {
  return `terminal-${crypto.randomUUID().slice(0, 8)}`;
}

function findTreeNode(node: TreeNode, id: string): TreeNode | null {
  if (node.id === id) return node;
  if (!isPane(node)) {
    for (const child of node.children) {
      const result = findTreeNode(child, id);
      if (result) return result;
    }
  }
  return null;
}

export function collectPaneIds(node: TreeNode): string[] {
  if (isPane(node)) return [node.id];
  return node.children.flatMap(collectPaneIds);
}

export function collectPanes(node: TreeNode): PaneNode[] {
  if (isPane(node)) return [node];
  return node.children.flatMap(collectPanes);
}

export function collectTerminalSessions(
  node: TreeNode
): TerminalSessionSummary[] {
  const sessions = new Map<string, TerminalSessionSummary>();

  for (const pane of collectPanes(node)) {
    if (pane.type !== "terminal") continue;
    const terminalSessionKey = getTerminalSessionKey(pane);
    const existing = sessions.get(terminalSessionKey);
    if (existing) {
      existing.paneIds.push(pane.id);
      continue;
    }
    sessions.set(terminalSessionKey, {
      terminalSessionKey,
      name: pane.name,
      paneIds: [pane.id],
      sandboxBinding: pane.sandboxBinding,
      sandboxId: pane.sandboxId,
    });
  }

  return [...sessions.values()].sort((left, right) =>
    left.name.localeCompare(right.name)
  );
}

export function createDefaultTree(): TreeNode {
  return {
    id: "p-home",
    type: "home",
    name: DEFAULT_PANE_NAMES.home,
    lines: [],
    status: "idle",
  };
}

function isFileBackedPane(node: PaneNode) {
  return node.type === "editor" || node.type === "preview";
}

function resolvePaneFileMutationSandboxId(
  node: PaneNode,
  scope?: FilePathMutationScope
) {
  const sandboxBinding = getPaneSandboxBinding(node);

  if (sandboxBinding === "pinned") {
    return node.sandboxId ?? null;
  }

  if (sandboxBinding === "session") {
    return scope?.activeSessionSandboxId ?? node.sandboxId ?? null;
  }

  return node.sandboxId ?? scope?.activeSessionSandboxId ?? null;
}

function shouldApplyFilePathMutation(
  node: PaneNode,
  scope?: FilePathMutationScope
) {
  if (!scope?.targetSandboxId) return true;
  return (
    resolvePaneFileMutationSandboxId(node, scope) === scope.targetSandboxId
  );
}

export function retargetPaneFilePaths(
  node: TreeNode,
  fromPath: string,
  toPath: string,
  scope?: FilePathMutationScope
): TreeNode {
  if (isPane(node)) {
    if (
      !isFileBackedPane(node) ||
      !node.filePath ||
      !shouldApplyFilePathMutation(node, scope)
    ) {
      return node;
    }
    const nextFilePath = retargetTreePath(node.filePath, fromPath, toPath);
    if (!nextFilePath || nextFilePath === node.filePath) return node;
    return {
      ...node,
      filePath: nextFilePath,
      ...(node.type === "editor"
        ? {
            name: stripDirectoryTreePath(getTreePathBasename(nextFilePath)),
          }
        : {}),
    };
  }

  return {
    ...node,
    children: node.children.map((child) =>
      retargetPaneFilePaths(child, fromPath, toPath, scope)
    ),
  };
}

export function clearPaneFilePaths(
  node: TreeNode,
  targetPath: string,
  scope?: FilePathMutationScope
): TreeNode {
  if (isPane(node)) {
    if (
      !isFileBackedPane(node) ||
      !node.filePath ||
      !matchesTreePathTarget(node.filePath, targetPath) ||
      !shouldApplyFilePathMutation(node, scope)
    ) {
      return node;
    }

    return {
      ...node,
      filePath: undefined,
      ...(node.type === "editor"
        ? {
            name: DEFAULT_PANE_NAMES.editor,
            status: "idle" as const,
          }
        : {}),
    };
  }

  return {
    ...node,
    children: node.children.map((child) =>
      clearPaneFilePaths(child, targetPath, scope)
    ),
  };
}

export function findFirstPaneIdByType(
  node: TreeNode,
  type: PaneType
): string | null {
  if (isPane(node)) return node.type === type ? node.id : null;

  for (const child of node.children) {
    const result = findFirstPaneIdByType(child, type);
    if (result) return result;
  }

  return null;
}

export function updatePaneNode(
  node: TreeNode,
  paneId: string,
  updates: Partial<PaneNode>
): TreeNode {
  if (isPane(node)) {
    return node.id === paneId ? { ...node, ...updates } : node;
  }

  return {
    ...node,
    children: node.children.map((child) =>
      updatePaneNode(child, paneId, updates)
    ),
  };
}

export function retargetSandboxPanes(
  node: TreeNode,
  previousSandboxId: string | null | undefined,
  nextSandboxId: string | null | undefined
): TreeNode {
  if (!previousSandboxId || previousSandboxId === nextSandboxId) {
    return node;
  }

  if (isPane(node)) {
    const sandboxBinding = getPaneSandboxBinding(node);
    if (sandboxBinding === "session") {
      return node.sandboxId ? { ...node, sandboxId: undefined } : node;
    }

    return node.sandboxId === previousSandboxId
      ? { ...node, sandboxId: nextSandboxId ?? undefined }
      : node;
  }

  return {
    ...node,
    children: node.children.map((child) =>
      retargetSandboxPanes(child, previousSandboxId, nextSandboxId)
    ),
  };
}

export function createWorkspaceTree(
  repoName?: string,
  rootDirectory?: string | null,
  options?: { previewTab?: PreviewPaneTab; sandboxId?: string | null }
): TreeNode {
  const repoShort = repoName
    ? repoName.split("/").pop() || repoName
    : "workspace";
  const label = rootDirectory
    ? `${repoShort}:${rootDirectory.split("/").pop()}`
    : repoShort;
  const uid = crypto.randomUUID().slice(0, 8);
  const terminalPaneId = `p-terminal-${uid}`;
  return {
    id: `s-root-${uid}`,
    dir: "horizontal",
    sizes: [35, 65],
    children: [
      {
        id: `p-agent-${uid}`,
        type: "agent",
        name: `Workspace Chat · ${label}`,
        lines: [],
        status: "idle",
        sandboxBinding: "session",
      },
      {
        id: `s-right-${uid}`,
        dir: "vertical",
        sizes: [65, 35],
        children: [
          {
            id: `p-preview-${uid}`,
            type: "preview",
            name: DEFAULT_PANE_NAMES.preview,
            lines: [],
            status: "idle",
            previewTab: options?.previewTab,
            sandboxBinding: "session",
          },
          {
            id: terminalPaneId,
            type: "terminal",
            name: DEFAULT_PANE_NAMES.terminal,
            lines: [],
            status: "idle",
            sandboxBinding: "session",
            terminalSessionKey: terminalPaneId,
          },
        ],
      },
    ],
  };
}

export function countPanes(node: TreeNode): number {
  if (isPane(node)) return 1;
  return node.children.reduce((acc, child) => acc + countPanes(child), 0);
}

// When the target pane's parent SplitNode already runs in the requested
// direction, insert the new pane as a sibling so the target pane's React key
// (and parent SplitNode key) are preserved. Wrapping in a new SplitNode there
// would change the parent's children-array slot key and unmount the existing
// pane (destroying e.g. a terminal's wterm buffer).
export type MovePosition = "left" | "right" | "top" | "bottom" | "swap";

function normalizeSizes(count: number): number[] {
  if (count <= 0) return [];
  const size = 100 / count;
  return Array.from({ length: count }, () => size);
}

// Removes the pane with `paneId` from the tree and returns the new root plus
// the detached pane. Single-child SplitNodes collapse into their lone child
// (mirrors closePane's collapse behavior). Sibling sizes are renormalized so
// they sum to 100. Returns { next: null } when the pane was the last in the
// tree, or { pane: null } when the id wasn't found.
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

// Inserts `pane` adjacent to the pane with `targetId` according to `position`.
// When the target's parent SplitNode already runs in the requested direction,
// the new pane becomes a sibling at index ± 1 — the parent SplitNode's id
// (and surrounding panes' React keys) are preserved, matching the invariant
// in splitTreeAt. Otherwise the target is wrapped in a new SplitNode of the
// requested direction.
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
        // the target by half — keeps all other siblings at their current sizes
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

// Swaps two panes by id. Each pane keeps its own id and content but takes
// the other's position in the tree. No structural change, no remount of
// surrounding panes.
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

// Moves the pane with `sourceId` next to (or onto) the pane with `targetId`.
// Returns the original root for noops (same pane, missing ids, last pane).
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

  // Verify target exists before detaching the source — a missing target would
  // silently remove the source pane with nowhere to insert it.
  if (!findTreeNode(root, targetId)) return root;

  const { next, pane } = detachPane(root, sourceId);
  if (!pane || !next) return root;

  return insertPaneAt(next, targetId, pane, position, newSplitId);
}

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

export function useSplitPanes() {
  const [root, setRoot] = useState(createDefaultTree());
  const [activeId, setActiveId] = useState("p-home");

  const findNode = useCallback(
    (node: TreeNode, id: string) => findTreeNode(node, id),
    []
  );

  const split = useCallback(
    (
      id: string,
      dir: SplitDir,
      newType: PaneType,
      overrides: Partial<PaneNode> = {}
    ) => {
      const newId = `p${crypto.randomUUID().slice(0, 8)}`;
      const newSplitId = `s${crypto.randomUUID().slice(0, 8)}`;
      setRoot((current) => {
        const newPane = createPaneNode(current, newId, newType, overrides);
        return splitTreeAt(current, id, dir, newPane, newSplitId);
      });
      setActiveId(newId);
    },
    []
  );

  const getAllPaneIds = useCallback(
    (node: TreeNode) => collectPaneIds(node),
    []
  );

  const closePane = useCallback(
    (id: string) => {
      const collapse = (node: TreeNode): TreeNode | null => {
        if (isPane(node)) return node.id === id ? null : node;
        const children = node.children
          .map(collapse)
          .filter(Boolean) as TreeNode[];
        if (children.length === 0) return null;
        if (children.length === 1) return children[0];
        return {
          ...node,
          children,
          sizes: children.map(() => 100 / children.length),
        };
      };
      const newRoot = collapse(root);
      if (newRoot) {
        setRoot(newRoot);
        if (activeId === id) {
          const remainingIds = getAllPaneIds(newRoot);
          if (remainingIds.length > 0) {
            setActiveId(remainingIds[0]);
          }
        }
      }
    },
    [root, activeId, getAllPaneIds]
  );

  const appendLine = useCallback((id: string, line: string) => {
    const update = (node: TreeNode): TreeNode => {
      if (isPane(node) && node.id === id) {
        return { ...node, lines: [...node.lines, line] };
      }
      if (!isPane(node))
        return { ...node, children: node.children.map(update) };
      return node;
    };
    setRoot(update);
  }, []);

  const setStatus = useCallback((id: string, s: PaneNode["status"]) => {
    const update = (node: TreeNode): TreeNode => {
      if (isPane(node) && node.id === id) return { ...node, status: s };
      if (!isPane(node))
        return { ...node, children: node.children.map(update) };
      return node;
    };
    setRoot(update);
  }, []);

  const openFile = useCallback(
    (
      filePath: string,
      options?: { sandboxId?: string; sandboxBinding?: PaneSandboxBinding }
    ) => {
      const fileName = filePath.split("/").pop() || filePath;
      let replaced = false;
      const activeNode = findTreeNode(root, activeId);
      const inheritedBinding =
        activeNode && isPane(activeNode)
          ? getPaneSandboxBinding(activeNode)
          : undefined;
      const editorSandboxBinding =
        options?.sandboxBinding ??
        inheritedBinding ??
        getPaneSandboxBinding({ type: "editor" });

      const update = (node: TreeNode): TreeNode => {
        if (isPane(node) && node.id === activeId && node.type === "editor") {
          replaced = true;
          return {
            ...node,
            name: fileName,
            filePath,
            sandboxBinding: editorSandboxBinding,
            sandboxId:
              editorSandboxBinding === "pinned"
                ? options?.sandboxId || node.sandboxId
                : undefined,
            status: "idle",
          };
        }
        if (!isPane(node)) {
          return { ...node, children: node.children.map(update) };
        }
        return node;
      };

      const updatedRoot = update(root);
      if (replaced) {
        setRoot(updatedRoot);
        return;
      }

      const newId = `p${crypto.randomUUID().slice(0, 8)}`;
      const newSplitId2 = `s${crypto.randomUUID().slice(0, 8)}`;
      const insert = (node: TreeNode): TreeNode => {
        if (isPane(node) && node.id === activeId) {
          return {
            id: newSplitId2,
            dir: "horizontal",
            sizes: [45, 55],
            children: [
              node,
              {
                id: newId,
                type: "editor",
                name: fileName,
                lines: [],
                status: "idle",
                filePath,
                sandboxBinding: editorSandboxBinding,
                sandboxId:
                  editorSandboxBinding === "pinned"
                    ? options?.sandboxId
                    : undefined,
              },
            ],
          };
        }
        if (!isPane(node)) {
          return { ...node, children: node.children.map(insert) };
        }
        return node;
      };

      setRoot(insert(root));
      setActiveId(newId);
    },
    [activeId, root]
  );

  const panes = useCallback((node: TreeNode) => collectPanes(node), []);

  const loadTree = useCallback((tree: TreeNode, active: string) => {
    setRoot(tree);
    setActiveId(active);
  }, []);

  const updatePane = useCallback((id: string, updates: Partial<PaneNode>) => {
    setRoot((current) => updatePaneNode(current, id, updates));
  }, []);

  const retargetFilePath = useCallback(
    (fromPath: string, toPath: string, scope?: FilePathMutationScope) => {
      setRoot((current) =>
        retargetPaneFilePaths(current, fromPath, toPath, scope)
      );
    },
    []
  );

  const clearFilePath = useCallback(
    (targetPath: string, scope?: FilePathMutationScope) => {
      setRoot((current) => clearPaneFilePaths(current, targetPath, scope));
    },
    []
  );

  const updateTerminalSession = useCallback(
    (terminalSessionKey: string, updates: Partial<PaneNode>) => {
      setRoot((current) => {
        const apply = (node: TreeNode): TreeNode => {
          if (isPane(node)) {
            return node.type === "terminal" &&
              getTerminalSessionKey(node) === terminalSessionKey
              ? { ...node, ...updates }
              : node;
          }
          return { ...node, children: node.children.map(apply) };
        };

        return apply(current);
      });
    },
    []
  );

  const updateSplitSizes = useCallback((splitId: string, sizes: number[]) => {
    setRoot((current) => updateSplitNodeSizes(current, splitId, sizes));
  }, []);

  const movePaneById = useCallback(
    (sourceId: string, targetId: string, position: MovePosition) => {
      setRoot((current) =>
        movePane(
          current,
          sourceId,
          targetId,
          position,
          `s${crypto.randomUUID().slice(0, 8)}`
        )
      );
    },
    []
  );

  const popOutIDE = useCallback((paneId: string, filePath?: string) => {
    const uid = crypto.randomUUID().slice(0, 8);
    const editorId = `p-editor-${uid}`;
    const update = (node: TreeNode): TreeNode => {
      if (isPane(node) && node.id === paneId && node.type === "preview") {
        const sandboxBinding = getPaneSandboxBinding(node);
        return {
          id: `s-ide-${uid}`,
          dir: "horizontal",
          sizes: [18, 47, 35],
          children: [
            {
              id: `p-files-${uid}`,
              type: "files",
              name: DEFAULT_PANE_NAMES.files,
              lines: [],
              status: "idle",
              sandboxBinding,
              sandboxId:
                sandboxBinding === "pinned" ? node.sandboxId : undefined,
            },
            {
              id: editorId,
              type: "editor",
              name: filePath
                ? filePath.split("/").pop() || DEFAULT_PANE_NAMES.editor
                : DEFAULT_PANE_NAMES.editor,
              lines: [],
              status: "idle",
              filePath,
              sandboxBinding,
              sandboxId:
                sandboxBinding === "pinned" ? node.sandboxId : undefined,
            },
            node,
          ],
        };
      }
      if (!isPane(node)) {
        return { ...node, children: node.children.map(update) };
      }
      return node;
    };
    setRoot(update);
    setActiveId(editorId);
  }, []);

  return {
    root,
    activeId,
    setActiveId,
    split,
    closePane,
    appendLine,
    setStatus,
    openFile,
    findNode,
    isPane,
    panes,
    loadTree,
    updatePane,
    retargetFilePath,
    clearFilePath,
    updateTerminalSession,
    updateSplitSizes,
    popOutIDE,
    movePane: movePaneById,
  };
}
