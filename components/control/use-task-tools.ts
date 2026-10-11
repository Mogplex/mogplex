"use client";

import { useCallback, useState } from "react";

export type TaskTool =
  | "preview"
  | "changes"
  | "files"
  | "plan"
  | "artifacts"
  | "sandboxes"
  | "worktrees";
export type TaskDrawer = "commands" | "terminal" | "logs";
type ToolState = {
  tool: TaskTool | null;
  drawer: TaskDrawer | null;
  terminalOpened: boolean;
  openedTools: TaskTool[];
  expanded: "tools" | "terminal" | null;
};
const EMPTY: ToolState = {
  tool: null,
  drawer: null,
  terminalOpened: false,
  openedTools: [],
  expanded: null,
};

/** View selection belongs to a conversation, independently of its running agent. */
export function useTaskTools(sessionId: string) {
  const [sessions, setSessions] = useState<Record<string, ToolState>>({});
  const state = sessions[sessionId] ?? EMPTY;
  const update = useCallback(
    (
      patch: Partial<ToolState> | ((previous: ToolState) => Partial<ToolState>)
    ) =>
      setSessions((current) => {
        const previous = current[sessionId] ?? EMPTY;
        return {
          ...current,
          [sessionId]: {
            ...previous,
            ...(typeof patch === "function" ? patch(previous) : patch),
          },
        };
      }),
    [sessionId]
  );
  const openTool = useCallback(
    (tool: TaskTool) =>
      update((previous) => ({
        tool,
        expanded: previous.expanded === "terminal" ? null : previous.expanded,
        openedTools: [...new Set([...previous.openedTools, tool])],
      })),
    [update]
  );
  const closeTool = useCallback(
    () =>
      update((previous) => ({
        tool: null,
        expanded: previous.expanded === "tools" ? null : previous.expanded,
      })),
    [update]
  );
  const toggleTool = useCallback(
    (tool: TaskTool) =>
      update((previous) => ({
        tool: previous.tool === tool ? null : tool,
        expanded:
          previous.tool === tool || previous.expanded === "terminal"
            ? null
            : previous.expanded,
        openedTools: [...new Set([...previous.openedTools, tool])],
      })),
    [update]
  );
  const openDrawer = useCallback(
    (drawer: TaskDrawer) =>
      update((previous) => ({
        drawer,
        expanded: previous.expanded === "tools" ? null : previous.expanded,
        ...(drawer === "terminal" ? { terminalOpened: true } : {}),
      })),
    [update]
  );
  const closeDrawer = useCallback(
    () =>
      update((previous) => ({
        drawer: null,
        expanded: previous.expanded === "terminal" ? null : previous.expanded,
      })),
    [update]
  );
  const toggleDrawer = useCallback(
    () =>
      update((previous) => ({
        drawer: previous.drawer ? null : "terminal",
        expanded: null,
        terminalOpened: true,
      })),
    [update]
  );
  const toggleExpanded = useCallback(
    (pane: "tools" | "terminal") =>
      update((previous) => ({
        expanded: previous.expanded === pane ? null : pane,
      })),
    [update]
  );
  const restoreSize = useCallback(() => update({ expanded: null }), [update]);
  return {
    ...state,
    openTool,
    closeTool,
    toggleTool,
    openDrawer,
    closeDrawer,
    toggleDrawer,
    toggleExpanded,
    restoreSize,
  };
}
