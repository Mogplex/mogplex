"use client";

import { useState, useCallback } from "react";

import {
  createDefaultTree,
  createPaneNode,
  getPaneSandboxBinding,
  getTerminalSessionKey,
} from "./split-panes-factories";
import {
  movePane,
  splitTreeAt,
  updateSplitNodeSizes,
} from "./split-panes-layout";
import {
  clearPaneFilePaths,
  findTreeNode,
  retargetPaneFilePaths,
  updatePaneNode,
} from "./split-panes-tree-ops";
import {
  collectPaneIds,
  collectPanes,
  DEFAULT_PANE_NAMES,
  isPane,
} from "./split-panes-types";

import type {
  FilePathMutationScope,
  MovePosition,
  PaneNode,
  PaneSandboxBinding,
  PaneType,
  SplitDir,
  TreeNode,
} from "./split-panes-types";

// Re-export all public types
export type {
  MovePosition,
  PaneNode,
  PaneSandboxBinding,
  PaneType,
  PreviewPaneTab,
  SplitDir,
  SplitNode,
  TerminalSessionSummary,
  TreeNode,
} from "./split-panes-types";

// Re-export public functions from factories
export {
  createDefaultTree,
  createPaneNode,
  createTerminalSessionKey,
  createWorkspaceTree,
  getPaneSandboxBinding,
  getTerminalSessionKey,
} from "./split-panes-factories";

// Re-export public functions from tree-ops
export {
  clearPaneFilePaths,
  collectPaneIds,
  collectPanes,
  collectTerminalSessions,
  countPanes,
  findFirstPaneIdByType,
  retargetPaneFilePaths,
  retargetSandboxPanes,
  updatePaneNode,
} from "./split-panes-tree-ops";

// Re-export public functions from layout
export {
  detachPane,
  insertPaneAt,
  movePane,
  splitTreeAt,
  swapPanes,
  updateSplitNodeSizes,
} from "./split-panes-layout";

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
