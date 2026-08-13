import assert from "node:assert/strict";
import test from "node:test";
import { normalizeControlChatMessages } from "../../app/api/control/chat/_lib/messages";
import { resolveControlPromptSandboxes } from "../../app/api/control/chat/_lib/context";
import { buildOrchestratorSystemPrompt } from "../../lib/agents/orchestrator/system-prompt";

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

test("plan mode adds explicit non-mutation intent to the orchestrator prompt", () => {
  const prompt = buildOrchestratorSystemPrompt({
    repoFullName: "acme/demo",
    missionId: "mission-1",
    missionTitle: "Fix onboarding",
    controlMode: "plan",
    controlScope: "PLAN ONLY",
    controlTarget: "mission",
    controlPermissions: "Ask First",
  });

  assert.match(prompt, /<control-intent>/);
  assert.match(prompt, /Mode: plan/);
  assert.match(prompt, /Scope: PLAN ONLY/);
  assert.match(prompt, /Target: mission/);
  assert.match(prompt, /Permissions: Ask First/);
  assert.match(prompt, /planning only/);
  assert.match(prompt, /do not spawn workers or mutate repository files/);
  assert.doesNotMatch(prompt, /Use spawn_worktree/);
});

test("orchestrator prompt keeps sandboxes and worktrees distinct", () => {
  const prompt = buildOrchestratorSystemPrompt({
    repoFullName: "acme/demo",
    activeSandboxes: [
      { id: "sandbox-record-1", branch: "feat/context", status: "running" },
    ],
  });

  assert.match(prompt, /Sandboxes and Git worktrees are separate resources/);
  assert.match(prompt, /Active worktrees:\n\(none\)/);
  assert.match(
    prompt,
    /sandbox-record-1: branch=feat\/context, status=running/
  );
});

test("control prompt sandbox context comes from an owned server record", async () => {
  const sandboxes = await resolveControlPromptSandboxes(
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

  assert.deepEqual(sandboxes, [
    {
      id: "sandbox-record-1",
      branch: "feat/server-owned",
      status: "running",
    },
  ]);
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
