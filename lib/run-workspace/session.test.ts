import { expect, it } from "vitest";
import { collectPanes } from "@/hooks/split-panes-types";
import { bindRunWorkspace } from "./session";
import type { RunWorkspaceContext } from "./types";

const context: RunWorkspaceContext = {
  runId: "run-1",
  aiCallId: "call-1",
  prompt: "Fix mobile",
  status: "streaming",
  sandboxRecordId: "sandbox-1",
  workingBranch: "fix/mobile",
  canGuide: true,
  repo: {
    id: "repo-1",
    user_id: "owner",
    full_name: "webrenew/vmotif",
    created_at: "",
  },
};

it("opens the exact run with chat, preview and terminal and no implicit restart", () => {
  const state = bindRunWorkspace([], context);
  const session = state.sessions[0];
  expect(session.activeSandboxId).toBe("sandbox-1");
  expect(session.externalRunId).toBe("run-1");
  expect(collectPanes(session.paneTree).map((p) => p.type)).toEqual([
    "agent",
    "preview",
    "terminal",
  ]);
  expect(collectPanes(session.paneTree)[0].externalRunId).toBe("run-1");
});

it("reopening a link reuses its tab without replacing another run in the same repo", () => {
  const first = bindRunWorkspace([], context);
  const second = bindRunWorkspace(first.sessions, {
    ...context,
    runId: "run-2",
  });
  const reopened = bindRunWorkspace(second.sessions, context);
  expect(reopened.sessions).toHaveLength(2);
  expect(reopened.activeSessionId).toBe(first.activeSessionId);
  expect(reopened.sessions[1]).toBe(second.sessions[1]);
});

it("reopening the run returns from a follow-up chat to the original run", () => {
  const first = bindRunWorkspace([], context);
  const pane = collectPanes(first.sessions[0].paneTree)[0];
  pane.externalRunId = undefined;
  pane.conversationId = "follow-up";
  const next = bindRunWorkspace(first.sessions, context);
  expect(collectPanes(next.sessions[0].paneTree)[0].externalRunId).toBe(
    context.runId
  );
  expect(pane.externalRunId).toBeUndefined();
});

it("restores a closed run chat without discarding the user's remaining panes", () => {
  const first = bindRunWorkspace([], context);
  const remaining = collectPanes(first.sessions[0].paneTree)[1];
  first.sessions[0].paneTree = remaining;
  const next = bindRunWorkspace(first.sessions, context);
  expect(collectPanes(next.sessions[0].paneTree)).toContain(remaining);
  expect(collectPanes(next.sessions[0].paneTree)[0].externalRunId).toBe(
    context.runId
  );
});
