import assert from "node:assert/strict";
import test from "node:test";
import { finishFlowPrReview } from "@/lib/workflows/automation-pr-review-tools";
import type {
  AutomationAgentResult,
  FlowAutoMergeRequest,
} from "@/lib/workflows/automation-job-types";

test("finishing a native flow review carries its deferred merge into post-review finalization", async () => {
  const result: AutomationAgentResult = {
    text: "No issues found",
    usage: null,
    steps: [
      {
        toolCalls: [
          {
            toolName: "reportReview",
            input: { hasIssues: false, summary: "No issues found" },
          },
        ],
      },
    ],
  };
  const request: FlowAutoMergeRequest = {
    prNumber: 42,
    expectedHeadSha: "a".repeat(40),
    commitTitle: "Approved title",
  };
  const input: Parameters<typeof finishFlowPrReview>[0] = {
    result,
    responseMessages: undefined,
    prompt: "Review PR 42",
    tools: {},
    generate: async (): Promise<AutomationAgentResult> => {
      throw new Error("No repair is needed");
    },
    judge: async () => [],
  };
  const finished = await finishFlowPrReview(input, () => request);
  assert.deepEqual(finished.autoMergeRequest, request);
  assert.equal(finished.reviewFormatPassed, true);
  assert.deepEqual(finished.steps, result.steps);
  assert.equal(
    (await finishFlowPrReview(input, () => null)).autoMergeRequest,
    undefined
  );
});
