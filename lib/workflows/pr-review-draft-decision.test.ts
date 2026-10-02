import { describe, expect, it } from "vitest";
import type { JobContext } from "./automation-job-types";
import {
  buildReviewerDraftDecisionContext,
  defaultAutomationAgentDeps,
} from "./automation-job-agent-runners-shared";

const context: JobContext = {
  assignmentType: "pr_review",
  skillId: null,
  agent: { model: "fixture", system_prompt: null },
  repo: { id: "repo", user_id: "owner", full_name: "acme/widgets" },
  metadata: { flow_job_run_id: "job", pr_number: 42 },
};

describe("default reviewer draft decision context", () => {
  it("runs the default judge without turning an unavailable check into a pass", async () => {
    const result = await defaultAutomationAgentDeps.judgeReviewFormat(
      {
        source: "structured",
        fallbackText: null,
        reviewOutcome: {
          hasIssues: false,
          summary: "Approve.",
          commentBody: null,
          affectedFiles: [],
          findings: [],
        },
      },
      context
    );
    expect(result).toBeNull();
  });
  it("pins job/PR metadata, draft stage, and the decision account scope", () => {
    expect(buildReviewerDraftDecisionContext(context)).toEqual({
      scope: {
        surface: "pr_review",
        userId: "owner",
        teamId: null,
        repoId: "repo",
        aiCallId: null,
      },
      metadata: { job_run_id: "job", pr_number: 42, stage: "reviewer_draft" },
    });
  });
  it("records missing standalone metadata as null and retains the repo's team", () => {
    expect(
      buildReviewerDraftDecisionContext({
        ...context,
        repo: { ...context.repo, product_team_id: "repo-team" },
        metadata: {},
      })
    ).toEqual({
      scope: {
        surface: "pr_review",
        userId: "owner",
        teamId: "repo-team",
        repoId: "repo",
        aiCallId: null,
      },
      metadata: { job_run_id: null, pr_number: null, stage: "reviewer_draft" },
    });
  });
  it("uses the explicit review team when present", () => {
    expect(
      buildReviewerDraftDecisionContext({
        ...context,
        repo: { ...context.repo, product_team_id: "repo-team" },
        metadata: { ...context.metadata, team_id: "review-team" },
      }).scope.teamId
    ).toBe("review-team");
  });
});
