import assert from "node:assert/strict";
import test from "node:test";
import {
  MogplexApiRunError,
  startMogplexApiRun,
} from "../../lib/mogplex-api/runs";
import {
  buildAiCall,
  buildRunRow,
  buildStartDeps,
  buildUser,
  type AiCall,
} from "./helpers/mogplex-api-runs-fixtures";

test("startMogplexApiRun creates a pending external run with ai_call metadata", async () => {
  const inserted: Array<unknown> = [];
  const acceptedEvents: Array<unknown> = [];

  const result = await startMogplexApiRun({
    user: buildUser(),
    idempotencyKey: "idem-1",
    body: {
      repoId: "repo-1",
      prompt: "Fix the tests",
      harness: "codex",
      baseBranch: "main",
      workingBranch: "mogplex/external/run",
      createBranch: true,
      rootDirectory: "apps/web",
    },
    deps: buildStartDeps({
      loadOwnedRepo: async () => ({
        id: "repo-1",
        full_name: "webrenew/mogplex",
        default_branch: "main",
        root_directory: null,
      }),
      loadRunByIdempotencyKey: async () => null,
      loadRunById: async () => null,
      findActiveSandbox: async () => ({
        id: "sandbox-record-1",
        sandbox_id: "sbx_123",
      }),
      createAiCall: async (input) =>
        buildAiCall({
          user_id: input.userId,
          type: input.type,
          model: input.model,
          status: input.status ?? "pending",
          conversation_id: input.conversationId ?? null,
          repo_id: input.repoId ?? null,
          metadata: input.metadata ?? {},
        }),
      insertRun: async (input) => {
        inserted.push(input);
        return buildRunRow({
          request_hash: input.requestHash,
          create_branch: input.normalized.createBranch,
          root_directory: input.normalized.rootDirectory,
        });
      },
      markRunQueued: async (input) =>
        buildRunRow({
          create_branch: true,
          root_directory: "apps/web",
          runtime_provider: input.runtimeProvider,
          runtime_run_id: input.runtimeRunId,
        }),
      appendAcceptedEvent: async (input) => {
        acceptedEvents.push(input);
      },
    }),
  });

  assert.equal(result.replayed, false);
  assert.equal(result.run.runId, "run-1");
  assert.equal(result.run.aiCallId, "call-1");
  assert.equal(result.run.sandboxRecordId, "sandbox-record-1");
  assert.equal(result.run.rootDirectory, "apps/web");
  assert.equal(inserted.length, 1);
  assert.equal(acceptedEvents.length, 1);
});

test("startMogplexApiRun merges extraMetadata without clobbering core fields", async () => {
  let aiCallMetadata: Record<string, unknown> | undefined;
  let runMetadata: Record<string, unknown> | undefined;

  await startMogplexApiRun({
    user: buildUser(),
    idempotencyKey: "idem-1",
    body: { repoId: "repo-1", prompt: "Fix the tests", harness: "codex" },
    extraMetadata: {
      slackRunControls: { teamId: "T1", channelId: "C1", messageTs: "1.1" },
      // A caller can't override a core metadata field.
      source: "evil",
    },
    deps: buildStartDeps({
      createAiCall: async (input) => {
        aiCallMetadata = input.metadata!;
        return buildAiCall({ metadata: input.metadata ?? {} });
      },
      insertRun: async (input) => {
        runMetadata = input.metadata as Record<string, unknown>;
        return buildRunRow({ request_hash: input.requestHash });
      },
    }),
  });

  assert.deepEqual(runMetadata?.slackRunControls, {
    teamId: "T1",
    channelId: "C1",
    messageTs: "1.1",
  });
  assert.equal(runMetadata?.source, "external-api");
  assert.deepEqual(aiCallMetadata, runMetadata);
});

test("startMogplexApiRun replays an existing idempotent request", async () => {
  let createdCalls = 0;
  const existing = buildRunRow({ request_hash: "" });

  const first = await startMogplexApiRun({
    user: buildUser(),
    idempotencyKey: "idem-1",
    body: {
      repoId: "repo-1",
      prompt: "Fix the tests",
      baseBranch: "main",
    },
    deps: buildStartDeps({
      loadOwnedRepo: async () => ({
        id: "repo-1",
        full_name: "webrenew/mogplex",
        default_branch: "main",
        root_directory: null,
      }),
      loadRunByIdempotencyKey: async () => null,
      loadRunById: async () => null,
      findActiveSandbox: async () => null,
      createAiCall: async () => {
        createdCalls += 1;
        return buildAiCall();
      },
      insertRun: async (input) => {
        existing.request_hash = input.requestHash;
        return {
          ...buildRunRow(),
          request_hash: input.requestHash,
          create_branch: input.normalized.createBranch,
          working_branch: "main",
        };
      },
      appendAcceptedEvent: async () => {},
    }),
  });

  const replay = await startMogplexApiRun({
    user: buildUser(),
    idempotencyKey: "idem-1",
    body: {
      repoId: "repo-1",
      prompt: "Fix the tests",
      baseBranch: "main",
    },
    deps: buildStartDeps({
      loadOwnedRepo: async () => ({
        id: "repo-1",
        full_name: "webrenew/mogplex",
        default_branch: "main",
        root_directory: null,
      }),
      loadRunByIdempotencyKey: async () => existing,
      loadRunById: async () => null,
      findActiveSandbox: async () => null,
      createAiCall: async () => {
        createdCalls += 1;
        return buildAiCall();
      },
      insertRun: async () => {
        throw new Error("insertRun should not run on replay");
      },
      appendAcceptedEvent: async () => {},
    }),
  });

  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(replay.run.runId, "run-1");
  assert.equal(createdCalls, 1);
});

test("startMogplexApiRun rejects idempotency conflicts", async () => {
  await assert.rejects(
    () =>
      startMogplexApiRun({
        user: buildUser(),
        idempotencyKey: "idem-1",
        body: {
          repoId: "repo-1",
          prompt: "Different request",
          baseBranch: "main",
        },
        deps: buildStartDeps({
          loadOwnedRepo: async () => ({
            id: "repo-1",
            full_name: "webrenew/mogplex",
            default_branch: "main",
            root_directory: null,
          }),
          loadRunByIdempotencyKey: async () =>
            buildRunRow({ request_hash: "not-this-request" }),
          loadRunById: async () => null,
          findActiveSandbox: async () => null,
          createAiCall: async () => buildAiCall(),
          insertRun: async () => buildRunRow(),
          appendAcceptedEvent: async () => {},
        }),
      }),
    (error) =>
      error instanceof MogplexApiRunError &&
      error.code === "IDEMPOTENCY_CONFLICT" &&
      error.status === 409
  );
});

test("startMogplexApiRun rejects invalid start requests before creating ai_calls", async () => {
  const cases: Array<{
    body: Record<string, unknown>;
    message: string;
  }> = [
    {
      body: { repoId: "repo-1", prompt: "Fix it", harness: "bogus" },
      message: "Invalid harness",
    },
    {
      body: { repoId: "repo-1", prompt: "Fix it", baseBranch: "../main" },
      message: "Invalid base branch",
    },
    {
      body: { repoId: "repo-1", prompt: "Fix it", rootDirectory: "../app" },
      message: "Invalid root directory",
    },
    {
      body: {
        repoId: "repo-1",
        prompt: "Fix it",
        createBranch: true,
        workingBranch: "main",
      },
      message:
        "Working branch must differ from base branch when createBranch is true",
    },
  ];

  for (const { body, message } of cases) {
    let createdCalls = 0;
    await assert.rejects(
      () =>
        startMogplexApiRun({
          user: buildUser(),
          idempotencyKey: "idem-1",
          body,
          deps: buildStartDeps({
            createAiCall: async () => {
              createdCalls += 1;
              return buildAiCall();
            },
          }),
        }),
      (error) =>
        error instanceof MogplexApiRunError &&
        error.code === "BAD_REQUEST" &&
        error.message === message
    );
    assert.equal(createdCalls, 0);
  }
});

test("startMogplexApiRun rejects repos outside the PAT user", async () => {
  await assert.rejects(
    () =>
      startMogplexApiRun({
        user: buildUser(),
        idempotencyKey: "idem-1",
        body: { repoId: "repo-404", prompt: "Fix it" },
        deps: buildStartDeps({
          loadOwnedRepo: async () => null,
          createAiCall: async () => {
            throw new Error("createAiCall should not run");
          },
        }),
      }),
    (error) =>
      error instanceof MogplexApiRunError &&
      error.code === "NOT_FOUND" &&
      error.status === 404
  );
});

test("startMogplexApiRun marks the run failed when queueing fails", async () => {
  const failedRows: Array<unknown> = [];

  await assert.rejects(
    () =>
      startMogplexApiRun({
        user: buildUser(),
        idempotencyKey: "idem-1",
        body: { repoId: "repo-1", prompt: "Fix it" },
        deps: buildStartDeps({
          queueRun: async () => {
            throw new Error("Trigger.dev runtime is not configured");
          },
          markRunFailed: async (input) => {
            failedRows.push(input);
            return buildRunRow({
              status: "failed",
              error: input.error,
            });
          },
        }),
      }),
    /Trigger\.dev runtime is not configured/
  );

  assert.deepEqual(failedRows, [
    {
      userId: "user-123",
      runId: "run-1",
      error: "Trigger.dev runtime is not configured",
    },
  ]);
});

test("startMogplexApiRun marks ai_call failed when external run insert fails", async () => {
  const failedCalls: Array<unknown> = [];

  await assert.rejects(
    () =>
      startMogplexApiRun({
        user: buildUser(),
        idempotencyKey: "idem-1",
        body: { repoId: "repo-1", prompt: "Fix it" },
        deps: buildStartDeps({
          insertRun: async () => {
            throw new Error("duplicate idempotency key");
          },
          markAiCallFailed: async (input) => {
            failedCalls.push(input);
          },
          appendAcceptedEvent: async () => {
            throw new Error("appendAcceptedEvent should not run");
          },
          queueRun: async () => {
            throw new Error("queueRun should not run");
          },
        }),
      }),
    /duplicate idempotency key/
  );

  assert.equal(failedCalls.length, 1);
  assert.equal((failedCalls[0] as { aiCall: AiCall }).aiCall.id, "call-1");
});
