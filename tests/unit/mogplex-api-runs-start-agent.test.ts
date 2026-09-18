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
} from "./helpers/mogplex-api-runs-fixtures";

test("startMogplexApiRun records the resolved roster agent on the run and its ai_call", async () => {
  let insertedAgentId: string | null | undefined;
  let aiCallMetadata: Record<string, unknown> = {};
  const result = await startMogplexApiRun({
    user: buildUser(),
    idempotencyKey: "idem-agent",
    body: {
      repoId: "repo-1",
      prompt: "Review the router",
      harness: "codex",
      agentId: "agent-42",
    },
    deps: buildStartDeps({
      resolveAgent: async (input) => {
        assert.deepEqual(input, { agentId: "agent-42", userId: "user-123" });
        return {
          id: "agent-42",
          name: "NEXTJS-REVIEWER",
          slug: "nextjs-reviewer",
          model: null,
          systemPrompt: "Review App Router code.",
          skills: [],
          rules: [],
          preset: false,
          teamId: null,
          ownerUserId: "user-123",
        };
      },
      createAiCall: async (input) => {
        aiCallMetadata = input.metadata ?? {};
        return buildAiCall({ metadata: aiCallMetadata });
      },
      insertRun: async (input) => {
        insertedAgentId = input.normalized.agentId;
        return buildRunRow({
          agent_id: input.normalized.agentId,
          request_hash: input.requestHash,
        });
      },
      markRunQueued: async () => buildRunRow({ agent_id: "agent-42" }),
    }),
  });

  assert.equal(insertedAgentId, "agent-42");
  assert.equal(aiCallMetadata.agent_id, "agent-42");
  assert.equal(aiCallMetadata.agent_name, "NEXTJS-REVIEWER");
  assert.equal(result.run.agentId, "agent-42");
});

test("startMogplexApiRun rejects an agent the caller cannot run as not found", async () => {
  let inserted = false;
  await assert.rejects(
    startMogplexApiRun({
      user: buildUser(),
      idempotencyKey: "idem-agent-missing",
      body: {
        repoId: "repo-1",
        prompt: "Review the router",
        harness: "codex",
        agentId: "someone-elses-agent",
      },
      deps: buildStartDeps({
        resolveAgent: async () => null,
        insertRun: async () => {
          inserted = true;
          return buildRunRow();
        },
      }),
    }),
    (error: unknown) =>
      error instanceof MogplexApiRunError &&
      error.code === "NOT_FOUND" &&
      error.status === 404 &&
      error.message === "Agent not found"
  );
  assert.equal(inserted, false);
});

test("startMogplexApiRun hashes the agent into the request so a different agent conflicts on replay", async () => {
  const existing = buildRunRow({
    idempotency_key: "idem-agent-replay",
    agent_id: "agent-1",
    request_hash: "hash-with-agent-1",
  });
  await assert.rejects(
    startMogplexApiRun({
      user: buildUser(),
      idempotencyKey: "idem-agent-replay",
      body: {
        repoId: "repo-1",
        prompt: existing.prompt,
        harness: existing.harness,
        workingBranch: existing.working_branch,
        agentId: "agent-2",
      },
      deps: buildStartDeps({
        loadRunByIdempotencyKey: async () => existing,
      }),
    }),
    (error: unknown) =>
      error instanceof MogplexApiRunError &&
      error.code === "IDEMPOTENCY_CONFLICT"
  );
});
