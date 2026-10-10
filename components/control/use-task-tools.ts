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
};
const EMPTY: ToolState = {
  tool: null,
  drawer: null,
  terminalOpened: false,
  openedTools: [],
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
        openedTools: [...new Set([...previous.openedTools, tool])],
      })),
    [update]
  );
  const closeTool = useCallback(() => update({ tool: null }), [update]);
  const openDrawer = useCallback(
    (drawer: TaskDrawer) =>
      update({
        drawer,
        ...(drawer === "terminal" ? { terminalOpened: true } : {}),
      }),
    [update]
  );
  const closeDrawer = useCallback(() => update({ drawer: null }), [update]);
  return { ...state, openTool, closeTool, openDrawer, closeDrawer };
}
