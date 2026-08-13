import assert from "node:assert/strict";
import test from "node:test";
import { normalizeControlChatMessages } from "../../app/api/control/chat/_lib/messages";
import {
  buildControlChatRunMetadata,
  resolveControlPromptSandboxContext,
  resolveControlPromptSandboxes,
  resolveControlPromptWorktrees,
} from "../../app/api/control/chat/_lib/context";

test("control run metadata keeps client resource hints non-authoritative", () => {
  const metadata = buildControlChatRunMetadata(
    {
      messages: [],
      sandboxId: "client-sandbox-hint",
      missionId: "client-mission-hint",
    },
    "team-1"
  );

  assert.equal(metadata.sandbox_id, null);
  assert.equal(metadata.sandbox_hint_id, "client-sandbox-hint");
  assert.equal(metadata.mission_id, null);
  assert.equal(metadata.mission_hint_id, "client-mission-hint");
  assert.equal(metadata.orchestration_run_id, null);
});

test("control chat normalization preserves AI SDK file parts", () => {
  const [message] = normalizeControlChatMessages([
    {
      role: "user",
      parts: [
        { type: "text", text: "Review this plan" },
        {
          type: "file",
          filename: "plan.txt",
          mediaType: "text/plain",
          url: "data:text/plain;base64,cGxhbg==",
        },
      ],
    },
  ]);

  assert.equal(message?.role, "user");
  assert.deepEqual(message?.parts, [
    { type: "text", text: "Review this plan" },
    {
      type: "file",
      filename: "plan.txt",
      mediaType: "text/plain",
      url: "data:text/plain;base64,cGxhbg==",
    },
  ]);
});

test("control chat normalization accepts legacy string content", () => {
  const [message] = normalizeControlChatMessages([
    { role: "user", content: "Create a release plan" },
  ]);

  assert.deepEqual(message?.parts, [
    { type: "text", text: "Create a release plan" },
  ]);
});

test("control chat normalization rejects malformed message shapes", () => {
  assert.throws(
    () =>
      normalizeControlChatMessages([
        null as unknown as Parameters<
          typeof normalizeControlChatMessages
        >[0][0],
      ]),
    /Invalid control chat message/
  );

  assert.throws(
    () =>
      normalizeControlChatMessages([
        {
          role: "user",
          content: { type: "file" } as unknown as [],
        },
      ]),
    /Invalid control chat message/
  );
});

test("control chat normalization rejects invalid file parts", () => {
  assert.throws(
    () =>
      normalizeControlChatMessages([
        {
          role: "user",
          parts: [
            {
              type: "file",
              filename: "empty.txt",
              mediaType: "text/plain",
              url: "",
            },
          ],
        },
      ]),
    /Invalid control chat file attachment/
  );

  assert.throws(
    () =>
      normalizeControlChatMessages([
        {
          role: "user",
          parts: [
            {
              type: "file",
              filename: "large.txt",
              mediaType: "text/plain",
              url: `data:text/plain;base64,${"a".repeat(5_600_001)}`,
            },
          ],
        },
      ]),
    /exceeds the size limit/
  );
});

test("control chat normalization rejects remote file URLs", () => {
  assert.throws(
    () =>
      normalizeControlChatMessages([
        {
          role: "user",
          parts: [
            {
              type: "file",
              filename: "remote.txt",
              mediaType: "text/plain",
              url: "https://example.com/remote.txt",
            },
          ],
        },
      ]),
    /must be uploaded as data URLs/
  );
});

test("control chat normalization caps file parts per request", () => {
  assert.throws(
    () =>
      normalizeControlChatMessages([
        {
          role: "user",
          parts: Array.from({ length: 6 }, (_, index) => ({
            type: "file" as const,
            filename: `attachment-${index}.txt`,
            mediaType: "text/plain",
            url: "data:text/plain;base64,cGxhbg==",
          })),
        },
      ]),
    /supports up to 5 file attachments/
  );
});

test("control chat normalization allows capped file parts across message history", () => {
  const messages = normalizeControlChatMessages([
    {
      role: "user",
      parts: Array.from({ length: 3 }, (_, index) => ({
        type: "file" as const,
        filename: `prior-${index}.txt`,
        mediaType: "text/plain",
        url: "data:text/plain;base64,cGxhbg==",
      })),
    },
    {
      role: "user",
      parts: Array.from({ length: 3 }, (_, index) => ({
        type: "file" as const,
        filename: `current-${index}.txt`,
        mediaType: "text/plain",
        url: "data:text/plain;base64,cGxhbg==",
      })),
    },
  ]);

  assert.equal(messages.length, 2);
  assert.equal(messages[0]?.parts.length, 3);
  assert.equal(messages[1]?.parts.length, 3);
});

test("control prompt sandbox context comes from an owned server record", async () => {
  const context = await resolveControlPromptSandboxContext(
    new Request("https://app.mogplex.com/api/control/chat"),
    {
      messages: [],
      repoId: "repo-1",
      repoBranch: "client-invented-branch",
      sandboxId: "sandbox-record-1",
    },
    {
      loadSandboxRecord: async () => ({
        ok: true,
        auth: {} as never,
        record: {
          id: "sandbox-record-1",
          sandbox_id: "sbx-runtime-1",
          repo_id: "repo-1",
          working_branch: "feat/server-owned",
          status: "running",
        },
        repo: null,
        rootDirectory: null,
      }),
    }
  );

  assert.deepEqual(context, {
    decisionSource: "server_validated_request",
    rejectionReason: null,
    selected: {
      recordId: "sandbox-record-1",
      runtimeId: "sbx-runtime-1",
    },
    sandboxes: [
      {
        id: "sandbox-record-1",
        branch: "feat/server-owned",
        status: "running",
      },
    ],
  });
});

test("control prompt rejects a sandbox from a different repository", async () => {
  const warnings: Array<Record<string, unknown>> = [];
  const sandboxes = await resolveControlPromptSandboxes(
    new Request("https://app.mogplex.com/api/control/chat"),
    { messages: [], repoId: "repo-1", sandboxId: "sandbox-record-2" },
    {
      loadSandboxRecord: async () => ({
        ok: true,
        auth: {} as never,
        record: {
          id: "sandbox-record-2",
          sandbox_id: "sbx-runtime-2",
          repo_id: "repo-2",
          working_branch: "feat/unrelated",
          status: "running",
        },
        repo: null,
        rootDirectory: null,
      }),
      warn: (_message, context) => warnings.push(context),
    }
  );

  assert.deepEqual(sandboxes, []);
  assert.deepEqual(warnings, [
    {
      sandboxId: "sandbox-record-2",
      repoId: "repo-1",
      sandboxRepoId: "repo-2",
    },
  ]);
});

test("control sandbox telemetry classifies stale and client-invented identifiers", async () => {
  for (const status of [404, 410]) {
    const context = await resolveControlPromptSandboxContext(
      new Request("https://app.mogplex.com/api/control/chat"),
      {
        messages: [],
        repoId: "repo-1",
        sandboxId: "client-invented-sandbox",
      },
      {
        loadSandboxRecord: async () => ({
          ok: false,
          status,
          error: "Sandbox not found",
        }),
      }
    );
    assert.deepEqual(context, {
      decisionSource: "none",
      rejectionReason: "sandbox_not_found",
      selected: null,
      sandboxes: [],
    });
  }
});

test("control prompt degrades when the sandbox loader returns a failure", async () => {
  const warnings: Array<Record<string, unknown>> = [];
  const sandboxes = await resolveControlPromptSandboxes(
    new Request("https://app.mogplex.com/api/control/chat"),
    { messages: [], repoId: "repo-1", sandboxId: "sandbox-record-1" },
    {
      loadSandboxRecord: async () => ({
        ok: false,
        status: 503,
        error: "Sandbox credentials unavailable",
      }),
      warn: (_message, context) => warnings.push(context),
    }
  );

  assert.deepEqual(sandboxes, []);
  assert.deepEqual(warnings, [
    {
      sandboxId: "sandbox-record-1",
      repoId: "repo-1",
      status: 503,
      error: "Sandbox credentials unavailable",
    },
  ]);
});

test("control prompt degrades when the sandbox loader throws", async () => {
  const failure = new Error("credential lookup timed out");
  const warnings: Array<Record<string, unknown>> = [];
  const sandboxes = await resolveControlPromptSandboxes(
    new Request("https://app.mogplex.com/api/control/chat"),
    { messages: [], repoId: "repo-1", sandboxId: "sandbox-record-1" },
    {
      loadSandboxRecord: async () => {
        throw failure;
      },
      warn: (_message, context) => warnings.push(context),
    }
  );

  assert.deepEqual(sandboxes, []);
  assert.deepEqual(warnings, [
    {
      sandboxId: "sandbox-record-1",
      repoId: "repo-1",
      error: failure,
    },
  ]);
});

test("control prompt loads worktrees through the owned session run", async () => {
  const result = await resolveControlPromptWorktrees(
    "user-1",
    {
      messages: [],
      conversationId: "session-1",
      repoId: "repo-1",
    },
    {
      loadSession: async () => ({
        user_id: "user-1",
        repo_id: "repo-1",
        orchestration_run_id: "run-1",
      }),
      listWorktrees: async () => [
        {
          id: "worktree-1",
          user_id: "user-1",
          run_id: "run-1",
          task_id: "task-1",
          repo_id: "repo-1",
          sandbox_id: "sandbox-1",
          agent_id: "agent-1",
          branch_name: "feat/server-owned",
          base_branch: "main",
          checkout_path: "/repo/.worktrees/worktree-1",
          status: "active",
          latest_commit_sha: null,
          error: null,
          metadata: {},
          created_at: "2026-08-13T00:00:00.000Z",
          updated_at: "2026-08-13T00:00:00.000Z",
          archived_at: null,
          pruned_at: null,
        },
      ],
    }
  );

  assert.deepEqual(result, {
    controlSessionId: "session-1",
    orchestrationRunId: "run-1",
    decisionSource: "owned_control_session",
    rejectionReason: null,
    worktrees: [
      {
        id: "worktree-1",
        taskId: "task-1",
        branch: "feat/server-owned",
        status: "active",
        sandboxId: "sandbox-1",
        checkoutPath: "/repo/.worktrees/worktree-1",
        agentId: "agent-1",
      },
    ],
  });
});

test("control prompt rejects worktree context for a mismatched session repo", async () => {
  let listed = false;
  const result = await resolveControlPromptWorktrees(
    "user-1",
    { messages: [], conversationId: "session-1", repoId: "repo-1" },
    {
      loadSession: async () => ({
        user_id: "user-1",
        repo_id: "repo-2",
        orchestration_run_id: "run-2",
      }),
      listWorktrees: async () => {
        listed = true;
        return [];
      },
    }
  );

  assert.deepEqual(result, {
    controlSessionId: null,
    orchestrationRunId: null,
    decisionSource: "none",
    rejectionReason: "repo_mismatch",
    worktrees: [],
  });
  assert.equal(listed, false);
});

test("control worktree context reports missing, unlinked, and failed session lookups", async () => {
  const body = {
    messages: [],
    conversationId: "session-1",
    repoId: "repo-1",
  };

  const missing = await resolveControlPromptWorktrees("user-1", body, {
    loadSession: async () => null,
    listWorktrees: async () => [],
  });
  assert.equal(missing.rejectionReason, "session_not_found");

  const unlinked = await resolveControlPromptWorktrees("user-1", body, {
    loadSession: async () => ({
      user_id: "user-1",
      repo_id: "repo-1",
      orchestration_run_id: null,
    }),
    listWorktrees: async () => [],
  });
  assert.equal(unlinked.rejectionReason, "mission_not_linked");

  const failed = await resolveControlPromptWorktrees("user-1", body, {
    loadSession: async () => {
      throw new Error("database unavailable");
    },
    listWorktrees: async () => [],
    warn: () => {},
  });
  assert.equal(failed.rejectionReason, "worktree_lookup_failed");
});

test("control worktree context rejects a client-invented mission identifier", async () => {
  let loaded = false;
  const result = await resolveControlPromptWorktrees(
    "user-1",
    {
      messages: [],
      conversationId: "session-1",
      missionId: "different-mission",
      repoId: "repo-1",
    },
    {
      loadSession: async () => {
        loaded = true;
        return null;
      },
      listWorktrees: async () => [],
    }
  );

  assert.deepEqual(result, {
    controlSessionId: null,
    orchestrationRunId: null,
    decisionSource: "none",
    rejectionReason: "mission_mismatch",
    worktrees: [],
  });
  assert.equal(loaded, false);
});
