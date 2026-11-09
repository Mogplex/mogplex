"use client";

import { useCallback, useEffect, useRef } from "react";
import { useSessionsStore } from "./use-sessions";
import {
  createDefaultTree,
  createPaneNode,
  getPaneSandboxBinding,
  getTerminalSessionKey,
} from "./split-panes-factories";
import {
  detachPane,
  insertPaneAt,
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

export {
  createDefaultTree,
  createPaneNode,
  createTerminalSessionKey,
  createWorkspaceTree,
  getPaneSandboxBinding,
  getTerminalSessionKey,
} from "./split-panes-factories";

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

export {
  detachPane,
  insertPaneAt,
  movePane,
  splitTreeAt,
  swapPanes,
  updateSplitNodeSizes,
} from "./split-panes-layout";

type TreeUpdate = { root: TreeNode; activeId: string };

const FALLBACK_TREE = createDefaultTree();

function updateSessionTree(
  sessionId: string | undefined,
  update: (root: TreeNode, activeId: string) => TreeUpdate
) {
  const state = useSessionsStore.getState();
  const session = state.sessions.find(
    (candidate) => candidate.id === sessionId
  );
  if (!session) return;
  const next = update(session.paneTree, session.activeId);
  state.updatePaneTree(next.root, next.activeId, { sessionId: session.id });
}

export function useSplitPanes() {
  const sessionId = useSessionsStore((state) => state.getActiveSession()?.id);
  const root = useSessionsStore(
    (state) => state.getActiveSession()?.paneTree ?? FALLBACK_TREE
  );
  const activeId = useSessionsStore(
    (state) => state.getActiveSession()?.activeId ?? FALLBACK_TREE.id
  );
  const updateActiveSessionTree = useCallback(
    (update: (root: TreeNode, activeId: string) => TreeUpdate) =>
      updateSessionTree(sessionId, update),
    [sessionId]
  );

  const setActiveId = useCallback(
    (id: string) => {
      updateActiveSessionTree((currentRoot) => ({
        root: currentRoot,
        activeId: id,
      }));
    },
    [updateActiveSessionTree]
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
      updateActiveSessionTree((currentRoot) => {
        const newPane = createPaneNode(currentRoot, newId, newType, overrides);
        return {
          root: splitTreeAt(currentRoot, id, dir, newPane, newSplitId),
          activeId: newId,
        };
      });
    },
    [updateActiveSessionTree]
  );

  const closePane = useCallback(
    (id: string) => {
      updateActiveSessionTree((currentRoot, currentActiveId) => {
        const { next } = detachPane(currentRoot, id);
        if (!next) return { root: currentRoot, activeId: currentActiveId };
        const remainingIds = collectPaneIds(next);
        return {
          root: next,
          activeId:
            currentActiveId === id && remainingIds.length > 0
              ? remainingIds[0]
              : currentActiveId,
        };
      });
    },
    [updateActiveSessionTree]
  );

  const openFile = useCallback(
    (
      filePath: string,
      options?: { sandboxId?: string; sandboxBinding?: PaneSandboxBinding }
    ) => {
      updateActiveSessionTree((currentRoot, currentActiveId) => {
        const fileName = filePath.split("/").pop() || filePath;
        const activeNode = findTreeNode(currentRoot, currentActiveId);
        const inheritedBinding =
          activeNode && isPane(activeNode)
            ? getPaneSandboxBinding(activeNode)
            : undefined;
        const sandboxBinding =
          options?.sandboxBinding ??
          inheritedBinding ??
          getPaneSandboxBinding({ type: "editor" });

        if (activeNode && isPane(activeNode) && activeNode.type === "editor") {
          return {
            root: updatePaneNode(currentRoot, currentActiveId, {
              name: fileName,
              filePath,
              sandboxBinding,
              sandboxId:
                sandboxBinding === "pinned"
                  ? options?.sandboxId || activeNode.sandboxId
                  : undefined,
              status: "idle",
            }),
            activeId: currentActiveId,
          };
        }

        if (!activeNode) {
          return { root: currentRoot, activeId: currentActiveId };
        }
        const newId = `p${crypto.randomUUID().slice(0, 8)}`;
        const newSplitId = `s${crypto.randomUUID().slice(0, 8)}`;
        const editor = createPaneNode(currentRoot, newId, "editor", {
          name: fileName,
          filePath,
          sandboxBinding,
          sandboxId:
            sandboxBinding === "pinned" ? options?.sandboxId : undefined,
        });
        return {
          root: insertPaneAt(
            currentRoot,
            currentActiveId,
            editor,
            "right",
            newSplitId
          ),
          activeId: newId,
        };
      });
    },
    [updateActiveSessionTree]
  );

  const updatePane = useCallback(
    (id: string, updates: Partial<PaneNode>) => {
      updateActiveSessionTree((currentRoot, currentActiveId) => ({
        root: updatePaneNode(currentRoot, id, updates),
        activeId: currentActiveId,
      }));
    },
    [updateActiveSessionTree]
  );

  const retargetFilePath = useCallback(
    (fromPath: string, toPath: string, scope?: FilePathMutationScope) => {
      updateActiveSessionTree((currentRoot, currentActiveId) => ({
        root: retargetPaneFilePaths(currentRoot, fromPath, toPath, scope),
        activeId: currentActiveId,
      }));
    },
    [updateActiveSessionTree]
  );

  const clearFilePath = useCallback(
    (targetPath: string, scope?: FilePathMutationScope) => {
      updateActiveSessionTree((currentRoot, currentActiveId) => ({
        root: clearPaneFilePaths(currentRoot, targetPath, scope),
        activeId: currentActiveId,
      }));
    },
    [updateActiveSessionTree]
  );

  const updateTerminalSession = useCallback(
    (terminalSessionKey: string, updates: Partial<PaneNode>) => {
      updateActiveSessionTree((currentRoot, currentActiveId) => {
        const apply = (node: TreeNode): TreeNode => {
          if (isPane(node)) {
            return node.type === "terminal" &&
              getTerminalSessionKey(node) === terminalSessionKey
              ? { ...node, ...updates }
              : node;
          }
          return { ...node, children: node.children.map(apply) };
        };
        return { root: apply(currentRoot), activeId: currentActiveId };
      });
    },
    [updateActiveSessionTree]
  );

  const splitSizeUpdateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const pendingSplitSizeUpdateRef = useRef<{
    splitId: string;
    sizes: number[];
    update: typeof updateActiveSessionTree;
  } | null>(null);

  const updateSplitSizes = useCallback(
    (splitId: string, sizes: number[]) => {
      if (splitSizeUpdateTimerRef.current) {
        pendingSplitSizeUpdateRef.current = {
          splitId,
          sizes,
          update: updateActiveSessionTree,
        };
        return;
      }

      updateActiveSessionTree((currentRoot, currentActiveId) => ({
        root: updateSplitNodeSizes(currentRoot, splitId, sizes),
        activeId: currentActiveId,
      }));
      splitSizeUpdateTimerRef.current = setTimeout(() => {
        splitSizeUpdateTimerRef.current = null;
        const pending = pendingSplitSizeUpdateRef.current;
        pendingSplitSizeUpdateRef.current = null;
        if (!pending) return;
        pending.update((currentRoot, currentActiveId) => ({
          root: updateSplitNodeSizes(
            currentRoot,
            pending.splitId,
            pending.sizes
          ),
          activeId: currentActiveId,
        }));
      }, 60);
    },
    [updateActiveSessionTree]
  );

  useEffect(
    () => () => {
      if (splitSizeUpdateTimerRef.current) {
        clearTimeout(splitSizeUpdateTimerRef.current);
      }
      const pending = pendingSplitSizeUpdateRef.current;
      if (!pending) return;
      pending.update((currentRoot, currentActiveId) => ({
        root: updateSplitNodeSizes(currentRoot, pending.splitId, pending.sizes),
        activeId: currentActiveId,
      }));
    },
    []
  );

  const movePaneById = useCallback(
    (sourceId: string, targetId: string, position: MovePosition) => {
      updateActiveSessionTree((currentRoot, currentActiveId) => ({
        root: movePane(
          currentRoot,
          sourceId,
          targetId,
          position,
          `s${crypto.randomUUID().slice(0, 8)}`
        ),
        activeId: currentActiveId,
      }));
    },
    [updateActiveSessionTree]
  );

  const popOutIDE = useCallback(
    (paneId: string, filePath?: string) => {
      updateActiveSessionTree((currentRoot) => {
        const uid = crypto.randomUUID().slice(0, 8);
        const editorId = `p-editor-${uid}`;
        const update = (node: TreeNode): TreeNode => {
          if (isPane(node) && node.id === paneId && node.type === "preview") {
            const sandboxBinding = getPaneSandboxBinding(node);
            const sandboxId =
              sandboxBinding === "pinned" ? node.sandboxId : undefined;
            return {
              id: `s-ide-${uid}`,
              dir: "horizontal",
              sizes: [18, 47, 35],
              children: [
                createPaneNode(node, `p-files-${uid}`, "files", {
                  sandboxBinding,
                  sandboxId,
                }),
                createPaneNode(node, editorId, "editor", {
                  name: filePath
                    ? filePath.split("/").pop() || DEFAULT_PANE_NAMES.editor
                    : DEFAULT_PANE_NAMES.editor,
                  filePath,
                  sandboxBinding,
                  sandboxId,
                }),
                node,
              ],
            };
          }
          if (!isPane(node)) {
            return { ...node, children: node.children.map(update) };
          }
          return node;
        };
        return { root: update(currentRoot), activeId: editorId };
      });
    },
    [updateActiveSessionTree]
  );

  return {
    root,
    activeId,
    setActiveId,
    split,
    closePane,
    openFile,
    updatePane,
    retargetFilePath,
    clearFilePath,
    updateTerminalSession,
    updateSplitSizes,
    popOutIDE,
    movePane: movePaneById,
  };
}
