import assert from "node:assert/strict";
import test from "node:test";
import type { UIMessage } from "ai";
import {
  buildActivityEntries,
  collectFileMutations,
} from "../../lib/control/activity-stream";

test("buildActivityEntries renders user and assistant text in order", () => {
  const messages = [
    {
      id: "u1",
      role: "user",
      parts: [{ type: "text", text: "Fix the login bug" }],
    },
    {
      id: "a1",
      role: "assistant",
      parts: [{ type: "text", text: "On it, reading the auth module." }],
    },
  ] as UIMessage[];

  const entries = buildActivityEntries(messages);

  assert.deepEqual(entries, [
    { kind: "user", id: "u1", text: "Fix the login bug" },
    {
      kind: "text",
      id: "a1-0",
      text: "On it, reading the auth module.",
      streaming: false,
    },
  ]);
});

test("buildActivityEntries maps tool states to running, done, and failed", () => {
  const messages = [
    {
      id: "a1",
      role: "assistant",
      parts: [
        {
          type: "tool-read_file",
          toolCallId: "c1",
          state: "input-available",
          input: { path: "app/page.tsx" },
        },
        {
          type: "tool-list_worktrees",
          toolCallId: "c2",
          state: "output-available",
          input: { missionId: "MSN-1" },
          output: { worktrees: [] },
        },
        {
          type: "tool-run_command",
          toolCallId: "c3",
          state: "output-error",
          input: { command: "pnpm test" },
          errorText: "exit code 1",
        },
      ],
    },
  ] as unknown as UIMessage[];

  const entries = buildActivityEntries(messages);

  assert.equal(entries.length, 3);
  assert.deepEqual(entries[0], {
    kind: "tool",
    id: "a1-0",
    name: "read_file",
    input: '{"path":"app/page.tsx"}',
    state: "running",
  });
  assert.deepEqual(entries[1], {
    kind: "tool",
    id: "a1-1",
    name: "list_worktrees",
    input: '{"missionId":"MSN-1"}',
    state: "done",
    output: '{"worktrees":[]}',
  });
  assert.deepEqual(entries[2], {
    kind: "tool",
    id: "a1-2",
    name: "run_command",
    input: '{"command":"pnpm test"}',
    state: "failed",
    error: "exit code 1",
  });
});

test("buildActivityEntries surfaces approval requests and outcomes", () => {
  const messages = [
    {
      id: "a1",
      role: "assistant",
      parts: [
        {
          type: "tool-git_push",
          toolCallId: "c1",
          state: "approval-requested",
          input: { branch: "main" },
          approval: { id: "ap-1" },
        },
        {
          type: "tool-git_push",
          toolCallId: "c2",
          state: "approval-responded",
          input: { branch: "main" },
          approval: { id: "ap-1", approved: true },
        },
      ],
    },
  ] as unknown as UIMessage[];

  const entries = buildActivityEntries(messages);

  assert.deepEqual(entries, [
    { kind: "approval", id: "a1-0", name: "git_push", state: "requested" },
    { kind: "approval", id: "a1-1", name: "git_push", state: "approved" },
  ]);
});

test("collectFileMutations lists file-mutating tool calls with paths", () => {
  const messages = [
    {
      id: "a1",
      role: "assistant",
      parts: [
        {
          type: "tool-write_file",
          toolCallId: "c1",
          state: "output-available",
          input: { path: "lib/new.ts", content: "..." },
          output: { ok: true },
        },
        {
          type: "tool-list_worktrees",
          toolCallId: "c2",
          state: "output-available",
          input: {},
          output: {},
        },
        {
          type: "tool-apply_patch",
          toolCallId: "c3",
          state: "output-error",
          input: { file_path: "lib/old.ts" },
          errorText: "conflict",
        },
      ],
    },
  ] as unknown as UIMessage[];

  const mutations = collectFileMutations(messages);

  assert.deepEqual(mutations, [
    { id: "a1-0", tool: "write_file", path: "lib/new.ts", state: "done" },
    { id: "a1-2", tool: "apply_patch", path: "lib/old.ts", state: "failed" },
  ]);
});
