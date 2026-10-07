import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { generateText, type ModelMessage } from "ai";
import { expect, it } from "vitest";
import { createPostgrestShim } from "@/lib/db/postgrest-shim";
import { createPrReviewCheckpointStore } from "@/lib/workflows/pr-review-checkpoint-store";
import {
  runCheckpointedPrReview,
  type ReviewCheckpointGenerate,
} from "@/lib/workflows/pr-review-checkpoint";
import { createAutomationTextGenerator } from "@/lib/workflows/automation-agent-generation";
import { buildPRReviewTools } from "@/lib/agents/pr-reviewer";
import { extractPrReviewHarnessResult } from "@/lib/workflows/pr-review-harness";
import type { JobContext } from "@/lib/workflows/automation-job-types";
import {
  createSuccessfulModelResult,
  createTestAutomationModel,
} from "@/tests/unit/helpers/automation-model-execution-fixtures";

const owner = "00000000-0000-4000-8000-000000000010";
const other = "00000000-0000-4000-8000-000000000011";
const firstJob = "00000000-0000-4000-8000-000000000001";
const retryJob = "00000000-0000-4000-8000-000000000002";
const thirdJob = "00000000-0000-4000-8000-000000000003";
const context: JobContext = {
  jobRunId: firstJob,
  assignmentType: "pr_review",
  skillId: null,
  agent: { model: "test/reviewer", system_prompt: null },
  repo: { id: "repo", user_id: owner, full_name: "acme/widgets" },
  metadata: {
    head_sha: "head",
    base_sha: "base",
    pr_number: 1,
    flow_node_id: "review",
    flow_version_id: "v1",
  },
};

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table profiles(id uuid primary key);
    create table job_runs(id uuid primary key, retry_of_job_run_id uuid);
    insert into profiles values ('${owner}'), ('${other}');
    insert into job_runs values ('${firstJob}', null), ('${retryJob}', '${firstJob}'), ('${thirdJob}', '${retryJob}');
  `);
  await db.exec(
    await readFile(
      new URL(
        "../../neon/migrations/20261007223000_pr_review_checkpoints.sql",
        import.meta.url
      ),
      "utf8"
    )
  );
  const client = createPostgrestShim({
    query: async (sql, values) => ({
      rows: (await db.query(sql, values ?? [])).rows as Record<
        string,
        unknown
      >[],
    }),
  }) as unknown as Parameters<typeof createPrReviewCheckpointStore>[0];
  return { db, store: createPrReviewCheckpointStore(client) };
}

function toolCall(name: string, input: unknown) {
  return {
    ...(createSuccessfulModelResult() as Awaited<
      ReturnType<
        ReturnType<typeof createTestAutomationModel>["model"]["doGenerate"]
      >
    >),
    content: [
      {
        type: "tool-call",
        toolName: name,
        toolCallId: `call-${name}`,
        input: JSON.stringify(input),
      },
    ],
    finishReason: { unified: "tool-calls", raw: "tool_calls" },
  };
}

function generator(
  model: ReturnType<typeof createTestAutomationModel>["model"]
): ReviewCheckpointGenerate {
  return createAutomationTextGenerator({
    context,
    resolvedModel: { model, effectiveModelId: "test/reviewer" },
    phase: "pr_review",
    generateText,
    instructions: "Review carefully",
  });
}

it("resumes durable completed steps after provider failure without repeating reads or billing old usage", async () => {
  const { db, store } = await fixture();
  try {
    let reads = 0;
    const tools = buildPRReviewTools({
      githubToken: "fixture",
      owner: "acme",
      repo: "widgets",
      prNumber: 1,
      fetch: async () => {
        reads++;
        return Response.json({
          number: 1,
          title: "Evidence already read",
          head: { sha: "head" },
          base: { sha: "base" },
        });
      },
    });
    const firstModel = createTestAutomationModel({
      onGenerate: (call) => {
        if (call === 1) return toolCall("getPullRequest", {});
        throw new Error("provider disconnected");
      },
    });
    const common = {
      context,
      instructions: "Review carefully",
      prompt: "Review PR #1",
      tools,
      store,
      restoreReportState() {},
      validateResume: async () => {},
    };
    await expect(
      runCheckpointedPrReview({
        ...common,
        generate: generator(firstModel.model),
      })
    ).rejects.toThrow("provider disconnected");
    const saved = (
      await db.query<{
        checkpoint: { steps: unknown[]; messages: ModelMessage[] };
      }>("select checkpoint from pr_review_checkpoints")
    ).rows[0].checkpoint;
    expect(saved.steps).toHaveLength(1);
    expect(JSON.stringify(saved.messages)).toContain("Evidence already read");
    expect(reads).toBe(1);
    const secondModel = createTestAutomationModel({
      onGenerate: (call) =>
        call === 1
          ? toolCall("reportReview", {
              hasIssues: true,
              summary: "One issue",
              findings: [
                {
                  severity: "warning",
                  title: "Lost update",
                  body: "The write overwrites a later update.",
                  path: "app.ts",
                },
              ],
            })
          : createSuccessfulModelResult("Review complete"),
    });
    let resumedMessages: ModelMessage[] | undefined;
    const review = await runCheckpointedPrReview({
      ...common,
      context: { ...context, jobRunId: retryJob },
      generate: async (request) => {
        resumedMessages = request.messages;
        return generator(secondModel.model)(request);
      },
    });
    expect(reads).toBe(1);
    expect(JSON.stringify(resumedMessages)).toContain("Evidence already read");
    expect(review.normalized.steps).toHaveLength(3);
    expect(review.normalized.usage).toMatchObject({
      inputTokens: 2,
      outputTokens: 2,
    });
    expect(
      extractPrReviewHarnessResult(review.normalized).reviewOutcome.findings
    ).toHaveLength(1);
    const reused = await runCheckpointedPrReview({
      ...common,
      context: { ...context, jobRunId: thirdJob },
      generate: async () => {
        throw new Error("must not regenerate a completed draft");
      },
    });
    expect(reused.normalized.steps).toHaveLength(3);
    expect(reused.normalized.usage).toBeNull();
    expect(
      extractPrReviewHarnessResult(reused.normalized).reviewOutcome.findings
    ).toHaveLength(1);
  } finally {
    await db.close();
  }
});

it("scopes recovery to the owner, node and exact review inputs, while leaving previous progress intact", async () => {
  const { db, store } = await fixture();
  try {
    const scope = {
      jobRunId: firstJob,
      userId: owner,
      nodeId: "review",
      fingerprint: "same",
    };
    const checkpoint = {
      version: 1 as const,
      messages: [],
      steps: [],
      text: "saved",
      complete: false,
      inFlightTool: null,
    };
    await store.save(scope, checkpoint);
    expect(await store.load({ ...scope, jobRunId: retryJob })).toEqual(
      checkpoint
    );
    // A retry can fail during model/auth setup before the reviewer starts.
    // The following retry must still reach the last durable progress.
    expect(await store.load({ ...scope, jobRunId: thirdJob })).toEqual(
      checkpoint
    );
    for (const change of [
      { userId: other },
      { nodeId: "another-review" },
      { fingerprint: "changed" },
    ]) {
      expect(
        await store.load({ ...scope, jobRunId: retryJob, ...change })
      ).toBeNull();
    }
    await expect(
      db.exec("set role authenticated; select * from pr_review_checkpoints")
    ).rejects.toThrow("permission denied");
    await db.exec("reset role");
    expect(await store.load(scope)).toEqual(checkpoint);
  } finally {
    await db.close();
  }
});

it("keeps a retry checkpoint when the retry fails before its first new step", async () => {
  const { db, store } = await fixture();
  try {
    const common = {
      context,
      instructions: "review",
      prompt: "review",
      tools: {},
      store,
      restoreReportState() {},
      validateResume: async () => {},
    };
    const first = createTestAutomationModel();
    await runCheckpointedPrReview({
      ...common,
      generate: generator(first.model),
    });
    await db.exec(
      "update pr_review_checkpoints set checkpoint = jsonb_set(checkpoint, '{complete}', 'false')"
    );
    await expect(
      runCheckpointedPrReview({
        ...common,
        context: { ...context, jobRunId: retryJob },
        generate: async () => {
          throw new Error("offline");
        },
      })
    ).rejects.toThrow("offline");
    const checkpoints = await db.query(
      "select checkpoint from pr_review_checkpoints order by job_run_id"
    );
    expect(checkpoints.rows).toHaveLength(2);
    expect(checkpoints.rows[1]).toEqual(checkpoints.rows[0]);
  } finally {
    await db.close();
  }
});

it("does not replay an action whose result is unknown", async () => {
  const { db, store } = await fixture();
  try {
    let writes = 0;
    const tools = buildPRReviewTools({
      githubToken: "fixture",
      owner: "acme",
      repo: "widgets",
      prNumber: 1,
      allowPrLifecycle: true,
      fetch: async () => {
        writes++;
        throw new Error("connection lost after write");
      },
    });
    const model = createTestAutomationModel({
      onGenerate: (call) => {
        if (call > 1) throw new Error("unexpected second call");
        return toolCall("closePullRequest", {});
      },
    });
    const common = {
      context,
      instructions: "review",
      prompt: "review",
      tools,
      store,
      restoreReportState() {},
      validateResume: async () => {},
    };
    await expect(
      runCheckpointedPrReview({ ...common, generate: generator(model.model) })
    ).rejects.toThrow("action did not return a result");
    expect(writes).toBe(1);
    expect(model.getDoGenerateCallCount()).toBe(1);
    await expect(
      runCheckpointedPrReview({
        ...common,
        context: { ...context, jobRunId: retryJob },
        generate: generator(model.model),
      })
    ).rejects.toThrow("unfinished action");
    await expect(
      runCheckpointedPrReview({
        ...common,
        context: {
          ...context,
          jobRunId: thirdJob,
          agent: { ...context.agent, model: "another/model" },
        },
        generate: generator(model.model),
      })
    ).rejects.toThrow("unfinished action");
    expect(writes).toBe(1);
    const saved = (
      await db.query<{ checkpoint: { inFlightTool: string } }>(
        "select checkpoint from pr_review_checkpoints"
      )
    ).rows[0].checkpoint;
    expect(saved.inFlightTool).toBe("closePullRequest");
  } finally {
    await db.close();
  }
});

it("does not reuse evidence after review inputs change", async () => {
  const { db, store } = await fixture();
  try {
    const common = {
      context,
      instructions: "review",
      prompt: "review",
      tools: {},
      store,
      restoreReportState() {},
      validateResume: async () => {},
    };
    await runCheckpointedPrReview({
      ...common,
      generate: generator(
        createTestAutomationModel({
          onGenerate: () => createSuccessfulModelResult("old evidence"),
        }).model
      ),
    });
    const changes = [
      { metadata: { ...context.metadata, head_sha: "new-head" } },
      { metadata: { ...context.metadata, base_sha: "new-base" } },
      { metadata: { ...context.metadata, flow_node_id: "other-node" } },
      { metadata: { ...context.metadata, flow_version_id: "v2" } },
      { agent: { ...context.agent, model: "other/model" } },
      { repo: { ...context.repo, user_id: other } },
    ];
    for (const change of changes) {
      const model = createTestAutomationModel({
        onGenerate: () => createSuccessfulModelResult("new evidence"),
      });
      const review = await runCheckpointedPrReview({
        ...common,
        context: { ...context, ...change, jobRunId: retryJob },
        generate: generator(model.model),
      });
      expect(review.normalized.text).toBe("new evidence");
      expect(model.getDoGenerateCallCount()).toBe(1);
    }
    const original = (
      await db.query<{ checkpoint: { text: string } }>(
        "select checkpoint from pr_review_checkpoints where job_run_id = $1",
        [firstJob]
      )
    ).rows[0].checkpoint;
    expect(original.text).toBe("old evidence");
  } finally {
    await db.close();
  }
});

it("stops before another model call when progress cannot be saved", async () => {
  const { db, store } = await fixture();
  try {
    let reads = 0;
    const tools = buildPRReviewTools({
      githubToken: "fixture",
      owner: "acme",
      repo: "widgets",
      prNumber: 1,
      fetch: async () => {
        reads++;
        await db.exec(
          "alter table pr_review_checkpoints add constraint simulate_storage_failure check (jsonb_array_length(checkpoint->'steps') = 0)"
        );
        return Response.json({ number: 1, title: "Read completed" });
      },
    });
    const model = createTestAutomationModel({
      onGenerate: (call) => {
        if (call > 1) throw new Error("unexpected second call");
        return toolCall("getPullRequest", {});
      },
    });
    await expect(
      runCheckpointedPrReview({
        context,
        instructions: "review",
        prompt: "review",
        tools,
        store,
        restoreReportState() {},
        validateResume: async () => {},
        generate: generator(model.model),
      })
    ).rejects.toThrow("save review progress");
    expect(reads).toBe(1);
    expect(model.getDoGenerateCallCount()).toBe(1);
    const saved = (
      await db.query<{ checkpoint: { steps: unknown[] } }>(
        "select checkpoint from pr_review_checkpoints"
      )
    ).rows[0].checkpoint;
    expect(saved.steps).toHaveLength(0);
  } finally {
    await db.close();
  }
});
