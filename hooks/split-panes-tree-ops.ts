import {
  getTreePathBasename,
  matchesTreePathTarget,
  retargetTreePath,
  stripDirectoryTreePath,
} from "@/lib/file-tree-paths";
import {
  getPaneSandboxBinding,
  getTerminalSessionKey,
} from "./split-panes-factories";
import {
  collectPanes,
  DEFAULT_PANE_NAMES,
  isPane,
  type FilePathMutationScope,
  type PaneNode,
  type PaneType,
  type TerminalSessionSummary,
  type TreeNode,
} from "./split-panes-types";

export { collectPaneIds, collectPanes } from "./split-panes-types";

export function findTreeNode(node: TreeNode, id: string): TreeNode | null {
  if (node.id === id) return node;
  if (!isPane(node)) {
    for (const child of node.children) {
      const result = findTreeNode(child, id);
      if (result) return result;
    }
  }
  return null;
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

export function countPanes(node: TreeNode): number {
  if (isPane(node)) return 1;
  return node.children.reduce((acc, child) => acc + countPanes(child), 0);
}
