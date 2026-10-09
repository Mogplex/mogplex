import assert from "node:assert/strict";
import test from "node:test";

import {
  parseGitHeadOutput,
  recordTerminalCommitSha,
  type RecordTerminalCommitDeps,
  type SandboxHeadResult,
  getSandboxHeadViaSdk,
  type SandboxCommandDeps,
  type SandboxRecord,
  type CommandResult,
} from "../../lib/mogplex-api/run-terminal-commit";
import type { ExternalAgentRunRow } from "../../lib/mogplex-api/runs-types";

// Tests for getSandboxHeadViaSdk - the lib-level SDK seam

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

// Tests for parseGitHeadOutput - the stdout parsing extracted for testability

test("parseGitHeadOutput extracts pushed SHA-1 commit", () => {
  const sha = "abc123def456abc123def456abc123def456abc1";
  const stdout = `HEAD_SHA=${sha}\nORIGIN_SHA=${sha}`;
  const result = parseGitHeadOutput(stdout);
  assert.equal(result.sha, sha);
  assert.equal(result.pushed, true);
});

test("parseGitHeadOutput extracts pushed SHA-256 commit", () => {
  const sha =
    "abc123def456abc123def456abc123def456abc123def456abc123def456abc1";
  const stdout = `HEAD_SHA=${sha}\nORIGIN_SHA=${sha}`;
  const result = parseGitHeadOutput(stdout);
  assert.equal(result.sha, sha);
  assert.equal(result.pushed, true);
});

test("parseGitHeadOutput detects unpushed commit (HEAD != origin)", () => {
  const headSha = "abc123def456abc123def456abc123def456abc1";
  const originSha = "def456abc123def456abc123def456abc123def4";
  const stdout = `HEAD_SHA=${headSha}\nORIGIN_SHA=${originSha}`;
  const result = parseGitHeadOutput(stdout);
  assert.equal(result.sha, headSha);
  assert.equal(result.pushed, false);
});

test("parseGitHeadOutput detects unpushed commit (no origin SHA)", () => {
  const headSha = "abc123def456abc123def456abc123def456abc1";
  const stdout = `HEAD_SHA=${headSha}\nORIGIN_SHA=`;
  const result = parseGitHeadOutput(stdout);
  assert.equal(result.sha, headSha);
  assert.equal(result.pushed, false);
});

test("parseGitHeadOutput returns null SHA for invalid format", () => {
  const stdout = `HEAD_SHA=invalid\nORIGIN_SHA=invalid`;
  const result = parseGitHeadOutput(stdout);
  assert.equal(result.sha, null);
  assert.equal(result.pushed, false);
});

test("parseGitHeadOutput returns null SHA for empty output", () => {
  const result = parseGitHeadOutput("");
  assert.equal(result.sha, null);
  assert.equal(result.pushed, false);
});

test("parseGitHeadOutput normalizes uppercase SHAs to lowercase", () => {
  const sha = "ABC123DEF456ABC123DEF456ABC123DEF456ABC1";
  const stdout = `HEAD_SHA=${sha}\nORIGIN_SHA=${sha}`;
  const result = parseGitHeadOutput(stdout);
  assert.equal(result.sha, sha.toLowerCase());
  assert.equal(result.pushed, true);
});

test("parseGitHeadOutput rejects truncated SHA (39 chars)", () => {
  const truncated = "abc123def456abc123def456abc123def456abc"; // 39 chars
  const stdout = `HEAD_SHA=${truncated}\nORIGIN_SHA=${truncated}`;
  const result = parseGitHeadOutput(stdout);
  assert.equal(result.sha, null);
  assert.equal(result.pushed, false);
});

test("parseGitHeadOutput handles extra whitespace in output", () => {
  const sha = "abc123def456abc123def456abc123def456abc1";
  const stdout = `  HEAD_SHA=${sha}  \n  ORIGIN_SHA=${sha}  \n`;
  const result = parseGitHeadOutput(stdout);
  assert.equal(result.sha, sha);
  assert.equal(result.pushed, true);
});

function buildSandboxRecord(
  overrides: Partial<SandboxRecord> = {}
): SandboxRecord {
  return {
    id: "sandbox-record-1",
    user_id: "user-1",
    repo_id: "repo-1",
    sandbox_id: "sandbox-1",
    status: "running",
    health_status: "healthy",
    exec_lock_token: null,
    persistent: false,
    billing_source: "platform",
    billing_team_id: "team-1",
    billing_project_id: "project-1",
    vercel_team_id: "team-1",
    vercel_project_id: "project-1",
    ...overrides,
  };
}

test("getSandboxHeadViaSdk returns pushed SHA when sandbox is running", async () => {
  const sha = "abc123def456abc123def456abc123def456abc1";
  const mockSandbox = { runCommand: async () => {} };
  const deps: SandboxCommandDeps = {
    loadSandboxRecord: async () => buildSandboxRecord(),
    getSandboxHandle: async () => mockSandbox as never,
    runSandboxShell: async (): Promise<CommandResult> => ({
      exitCode: 0,
      stdout: `HEAD_SHA=${sha}\nORIGIN_SHA=${sha}`,
      stderr: "",
    }),
  };

  const result = await getSandboxHeadViaSdk("record-1", "user-1", "main", deps);
  assert.equal(result.sha, sha);
  assert.equal(result.pushed, true);
});

test("getSandboxHeadViaSdk skips when sandbox record not found", async () => {
  const logs: Array<{ message: string; data: unknown }> = [];
  const originalWarn = console.warn;
  console.warn = (msg: string, data: unknown) =>
    logs.push({ message: msg, data });

  const deps: SandboxCommandDeps = {
    loadSandboxRecord: async () => null,
    getSandboxHandle: async () => {
      throw new Error("Should not be called");
    },
    runSandboxShell: async () => {
      throw new Error("Should not be called");
    },
  };

  try {
    const result = await getSandboxHeadViaSdk(
      "record-1",
      "user-1",
      "main",
      deps
    );
    assert.equal(result.sha, null);
    assert.equal(result.pushed, false);
    assert.ok(logs.some((l) => l.message.includes("sandbox record not found")));
  } finally {
    console.warn = originalWarn;
  }
});

test("getSandboxHeadViaSdk skips when sandbox not running", async () => {
  const logs: Array<{ message: string; data: unknown }> = [];
  const originalWarn = console.warn;
  console.warn = (msg: string, data: unknown) =>
    logs.push({ message: msg, data });

  const deps: SandboxCommandDeps = {
    loadSandboxRecord: async () => buildSandboxRecord({ status: "stopped" }),
    getSandboxHandle: async () => {
      throw new Error("Should not be called");
    },
    runSandboxShell: async () => {
      throw new Error("Should not be called");
    },
  };

  try {
    const result = await getSandboxHeadViaSdk(
      "record-1",
      "user-1",
      "main",
      deps
    );
    assert.equal(result.sha, null);
    assert.ok(logs.some((l) => l.message.includes("sandbox not running")));
  } finally {
    console.warn = originalWarn;
  }
});

test("getSandboxHeadViaSdk skips when sandbox handle unavailable", async () => {
  const logs: Array<{ message: string; data: unknown }> = [];
  const originalWarn = console.warn;
  console.warn = (msg: string, data: unknown) =>
    logs.push({ message: msg, data });

  const deps: SandboxCommandDeps = {
    loadSandboxRecord: async () => buildSandboxRecord(),
    getSandboxHandle: async () => null,
    runSandboxShell: async () => {
      throw new Error("Should not be called");
    },
  };

  try {
    const result = await getSandboxHeadViaSdk(
      "record-1",
      "user-1",
      "main",
      deps
    );
    assert.equal(result.sha, null);
    assert.ok(
      logs.some((l) => l.message.includes("could not get sandbox handle"))
    );
  } finally {
    console.warn = originalWarn;
  }
});

test("getSandboxHeadViaSdk logs exit code on git command failure", async () => {
  const logs: Array<{ message: string; data: Record<string, unknown> }> = [];
  const originalWarn = console.warn;
  console.warn = (msg: string, data: Record<string, unknown>) =>
    logs.push({ message: msg, data });

  const mockSandbox = { runCommand: async () => {} };
  const deps: SandboxCommandDeps = {
    loadSandboxRecord: async () => buildSandboxRecord(),
    getSandboxHandle: async () => mockSandbox as never,
    runSandboxShell: async (): Promise<CommandResult> => ({
      exitCode: 128,
      stdout: "",
      stderr: "fatal: not a git repository",
    }),
  };

  try {
    const result = await getSandboxHeadViaSdk(
      "record-1",
      "user-1",
      "main",
      deps
    );
    assert.equal(result.sha, null);
    const failLog = logs.find((l) => l.message.includes("git command failed"));
    assert.ok(failLog);
    assert.equal(failLog?.data?.exitCode, 128);
    assert.ok(String(failLog?.data?.stderr).includes("not a git repository"));
  } finally {
    console.warn = originalWarn;
  }
});

test("getSandboxHeadViaSdk logs error class on sandbox command exception", async () => {
  const logs: Array<{ message: string; data: Record<string, unknown> }> = [];
  const originalWarn = console.warn;
  console.warn = (msg: string, data: Record<string, unknown>) =>
    logs.push({ message: msg, data });

  const mockSandbox = { runCommand: async () => {} };
  const deps: SandboxCommandDeps = {
    loadSandboxRecord: async () => buildSandboxRecord(),
    getSandboxHandle: async () => mockSandbox as never,
    runSandboxShell: async () => {
      throw new TypeError("Connection reset");
    },
  };

  try {
    const result = await getSandboxHeadViaSdk(
      "record-1",
      "user-1",
      "main",
      deps
    );
    assert.equal(result.sha, null);
    const failLog = logs.find((l) =>
      l.message.includes("sandbox command failed")
    );
    assert.ok(failLog);
    assert.equal(failLog?.data?.errorClass, "TypeError");
    assert.equal(failLog?.data?.errorMessage, "Connection reset");
  } finally {
    console.warn = originalWarn;
  }
});
