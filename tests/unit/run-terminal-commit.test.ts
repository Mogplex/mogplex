import assert from "node:assert/strict";
import test from "node:test";

import {
  recordTerminalCommitSha,
  type RecordTerminalCommitDeps,
  type SandboxHeadResult,
} from "../../lib/mogplex-api/run-terminal-commit";
import type { ExternalAgentRunRow } from "../../lib/mogplex-api/runs-types";

function buildRun(
  overrides: Partial<ExternalAgentRunRow> = {}
): ExternalAgentRunRow {
  return {
    id: "run-1",
    user_id: "user-1",
    repo_id: "repo-1",
    ai_call_id: "call-1",
    sandbox_record_id: "sandbox-record-1",
    sandbox_id: "sandbox-1",
    worktree_id: null,
    idempotency_key: "key-1",
    request_hash: "hash-1",
    harness: "mogplex",
    status: "success",
    prompt: "test",
    base_branch: "main",
    working_branch: "feature/test",
    create_branch: true,
    root_directory: null,
    conversation_id: null,
    workspace_session_id: null,
    mode: null,
    agent_id: null,
    runtime_provider: null,
    runtime_run_id: null,
    error: null,
    metadata: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

test("recordTerminalCommitSha records SHA when sandbox HEAD is pushed", async () => {
  const updates: Array<{
    userId: string;
    runId: string;
    key: string;
    value: string;
  }> = [];

  const deps: RecordTerminalCommitDeps = {
    getSandboxHead: async (): Promise<SandboxHeadResult> => ({
      sha: "abc123def456abc123def456abc123def456abc1",
      pushed: true,
    }),
    updateRunMetadata: async (userId, runId, key, value) => {
      updates.push({ userId, runId, key, value });
    },
  };

  await recordTerminalCommitSha(buildRun(), deps);

  assert.equal(updates.length, 1);
  assert.equal(updates[0].key, "terminal_commit_sha");
  assert.equal(updates[0].value, "abc123def456abc123def456abc123def456abc1");
});

test("recordTerminalCommitSha skips recording when HEAD is not pushed", async () => {
  const updates: string[] = [];
  const logs: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    logs.push(String(args[0]));
  };

  const deps: RecordTerminalCommitDeps = {
    getSandboxHead: async (): Promise<SandboxHeadResult> => ({
      sha: "abc123def456abc123def456abc123def456abc1",
      pushed: false, // Not pushed
    }),
    updateRunMetadata: async (_, __, key) => {
      updates.push(key);
    },
  };

  try {
    await recordTerminalCommitSha(buildRun(), deps);
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(updates.length, 0);
  assert.ok(logs.some((log) => log.includes("[terminal-commit]")));
});

test("recordTerminalCommitSha skips when sandbox_record_id is missing", async () => {
  const updates: string[] = [];
  const logs: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    logs.push(String(args[0]));
  };

  const deps: RecordTerminalCommitDeps = {
    getSandboxHead: async (): Promise<SandboxHeadResult> => {
      throw new Error("Should not be called");
    },
    updateRunMetadata: async (_, __, key) => {
      updates.push(key);
    },
  };

  try {
    await recordTerminalCommitSha(buildRun({ sandbox_record_id: null }), deps);
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(updates.length, 0);
  assert.ok(logs.some((log) => log.includes("no sandbox_record_id")));
});

test("recordTerminalCommitSha skips when getSandboxHead returns no SHA", async () => {
  const updates: string[] = [];

  const deps: RecordTerminalCommitDeps = {
    getSandboxHead: async (): Promise<SandboxHeadResult> => ({
      sha: null,
      pushed: false,
    }),
    updateRunMetadata: async (_, __, key) => {
      updates.push(key);
    },
  };

  await recordTerminalCommitSha(buildRun(), deps);

  assert.equal(updates.length, 0);
});

test("recordTerminalCommitSha never throws on failure", async () => {
  const deps: RecordTerminalCommitDeps = {
    getSandboxHead: async (): Promise<SandboxHeadResult> => {
      throw new Error("Sandbox connection failed");
    },
    updateRunMetadata: async () => {
      throw new Error("Should not be called");
    },
  };

  // Should not throw
  await recordTerminalCommitSha(buildRun(), deps);
});

test("recordTerminalCommitSha accepts SHA-256 (64 character) commits", async () => {
  const updates: Array<{ value: string }> = [];
  const sha256 =
    "abc123def456abc123def456abc123def456abc123def456abc123def456abc1";

  const deps: RecordTerminalCommitDeps = {
    getSandboxHead: async (): Promise<SandboxHeadResult> => ({
      sha: sha256,
      pushed: true,
    }),
    updateRunMetadata: async (_, __, ___, value) => {
      updates.push({ value });
    },
  };

  await recordTerminalCommitSha(buildRun(), deps);

  assert.equal(updates.length, 1);
  assert.equal(updates[0].value, sha256);
});
