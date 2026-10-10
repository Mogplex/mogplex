import { expect, it } from "vitest";
import { runCheckpointedPrReview } from "./pr-review-checkpoint";
import type { PrReviewCheckpoint } from "./pr-review-checkpoint-store";
import type { JobContext } from "./automation-job-types";

const context: JobContext = {
  jobRunId: "retry",
  assignmentType: "pr_review",
  skillId: null,
  agent: { model: "test/reviewer", system_prompt: null },
  repo: { id: "repo", user_id: "owner", full_name: "acme/widgets" },
  metadata: { head_sha: "head" },
};

it.each(["unstarted", "reviewed", "unfinished action"] as const)(
  "resumes a %s checkpoint without inventing review work or replaying actions",
  async (state) => {
    const checkpoint: PrReviewCheckpoint = {
      version: 1,
      messages: [{ role: "assistant", content: "Previous attempt" }],
      steps:
        state === "reviewed"
          ? [{ toolCalls: [{ toolName: "getPullRequest", input: {} }] }]
          : [{}],
      text: "Previous attempt",
      complete: true,
      inFlightTools:
        state === "unfinished action"
          ? [{ toolName: "createIssue", toolCallId: "pending", input: {} }]
          : [],
    };
    let generations = 0;
    let restoredSteps: PrReviewCheckpoint["steps"] = [];
    const saved: PrReviewCheckpoint[] = [];
    const run = runCheckpointedPrReview({
      context,
      instructions: "Review carefully",
      prompt: "Review PR #625",
      tools: {},
      store: {
        load: async () => checkpoint,
        save: async (_scope, value) => {
          saved.push(value);
        },
      },
      restoreReportState: (steps) => {
        restoredSteps = steps;
      },
      validateResume: async () => {},
      generate: async (request) => {
        generations++;
        expect(request.messages).toBeUndefined();
        expect(request.prompt).toBe("Review PR #625");
        return {
          normalized: { text: "Fresh attempt", steps: [], usage: null },
        };
      },
    });
    if (state === "unfinished action") {
      await expect(run).rejects.toThrow("unfinished action");
      expect(generations).toBe(0);
      expect(saved[0].inFlightTools).toEqual(checkpoint.inFlightTools);
    } else {
      const result = await run;
      expect(result.normalized.text).toBe(
        state === "unstarted" ? "Fresh attempt" : "Previous attempt"
      );
      expect(generations).toBe(state === "unstarted" ? 1 : 0);
      expect(restoredSteps).toEqual(
        state === "unstarted" ? [] : checkpoint.steps
      );
    }
    expect(checkpoint.text).toBe("Previous attempt");
  }
);
