import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { generateText } from "ai";
import { expect, it } from "vitest";
import { createPostgrestShim } from "@/lib/db/postgrest-shim";
import { createPrReviewCheckpointStore } from "@/lib/workflows/pr-review-checkpoint-store";
import { runCheckpointedPrReview } from "@/lib/workflows/pr-review-checkpoint";
import { createAutomationTextGenerator } from "@/lib/workflows/automation-agent-generation";
import { buildPRReviewTools } from "@/lib/agents/pr-reviewer";
import type { JobContext } from "@/lib/workflows/automation-job-types";
import {
  createSuccessfulModelResult,
  createTestAutomationModel,
} from "@/tests/unit/helpers/automation-model-execution-fixtures";

const owner = "00000000-0000-4000-8000-000000000010";
const firstJob = "00000000-0000-4000-8000-000000000001";
const retryJob = "00000000-0000-4000-8000-000000000002";
const context: JobContext = {
  jobRunId: firstJob,
  assignmentType: "pr_review",
  skillId: null,
  agent: { model: "test/reviewer", system_prompt: null },
  repo: { id: "repo", user_id: owner, full_name: "acme/widgets" },
  metadata: {
    head_sha: "head",
    base_sha: "base",
    pr_number: 625,
    flow_node_id: "review",
  },
};

it.each([false, true])(
  "restarts an empty completed review unless an action is unresolved (%s)",
  async (unfinishedAction) => {
    const db = new PGlite();
    try {
      await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create table profiles(id uuid primary key);
      create table job_runs(id uuid primary key, retry_of_job_run_id uuid);
      insert into profiles values ('${owner}');
      insert into job_runs values ('${firstJob}', null), ('${retryJob}', '${firstJob}');
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
      let reads = 0;
      const tools = buildPRReviewTools({
        githubToken: "fixture",
        owner: "acme",
        repo: "widgets",
        prNumber: 625,
        fetch: async () => {
          reads++;
          return Response.json({ number: 625, title: "Fresh PR evidence" });
        },
      });
      const common = {
        context,
        instructions: "Review",
        prompt: "Review PR #625",
        tools,
        store: createPrReviewCheckpointStore(client),
        restoreReportState() {},
        validateResume: async () => {},
      };
      const generator = (
        model: ReturnType<typeof createTestAutomationModel>["model"]
      ) =>
        createAutomationTextGenerator({
          context,
          resolvedModel: { model, effectiveModelId: "test/reviewer" },
          phase: "pr_review",
          generateText,
          instructions: "Review",
        });
      const unstarted = createTestAutomationModel({
        onGenerate: () => createSuccessfulModelResult("Review not started"),
      });
      await runCheckpointedPrReview({
        ...common,
        generate: generator(unstarted.model),
      });
      if (unfinishedAction) {
        await db.query(
          "update pr_review_checkpoints set checkpoint = jsonb_set(checkpoint, '{inFlightTools}', $1::jsonb) where job_run_id = $2",
          [
            JSON.stringify([
              {
                toolName: "createIssue",
                toolCallId: "unknown-action",
                input: {},
              },
            ]),
            firstJob,
          ]
        );
      }
      const resumed = createTestAutomationModel({
        onGenerate: (call) =>
          call === 1
            ? {
                ...(createSuccessfulModelResult() as object),
                content: [
                  {
                    type: "tool-call",
                    toolName: "getPullRequest",
                    toolCallId: "read-pr",
                    input: "{}",
                  },
                ],
                finishReason: { unified: "tool-calls", raw: "tool_calls" },
              }
            : createSuccessfulModelResult("PR evidence read"),
      });
      const rerun = runCheckpointedPrReview({
        ...common,
        context: { ...context, jobRunId: retryJob },
        generate: generator(resumed.model),
      });
      if (unfinishedAction) {
        await expect(rerun).rejects.toThrow("unfinished action");
        expect(resumed.getDoGenerateCallCount()).toBe(0);
        expect(reads).toBe(0);
      } else {
        const review = await rerun;
        expect(reads).toBe(1);
        expect(review.normalized.text).toBe("PR evidence read");
        expect(JSON.stringify(review.responseMessages)).toContain(
          "Fresh PR evidence"
        );
        expect(JSON.stringify(review.responseMessages)).not.toContain(
          "Review not started"
        );
        expect(resumed.getDoGenerateCallCount()).toBe(2);
      }
      const original = (
        await db.query<{ text: string }>(
          "select checkpoint->>'text' as text from pr_review_checkpoints where job_run_id = $1",
          [firstJob]
        )
      ).rows[0];
      expect(original.text).toBe("Review not started");
    } finally {
      await db.close();
    }
  }
);
