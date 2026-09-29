import { describe, expect, it } from "vitest";
import type { DecisionHandle } from "@/lib/decisions/decide";
import type { DecisionId, DecisionScope } from "@/lib/decisions/types";
import {
  finalizePrReviewSuccess,
  type FinalizePrReviewSuccessContext,
} from "./automation-job-pr-review-finalize";
import type { PrReviewReporterState } from "./automation-job-pr-review-reporter";
import type { JobContext } from "./automation-job-types";
import {
  findReviewFormatProblems,
  polishPrReviewForPublish,
  type PrReviewFormatDeps,
  type PrReviewRewrite,
} from "./pr-review-format-check";
import { buildPrReviewTimelineCommentBody } from "./pr-review-harness";
import { extractPrReviewHarnessResult } from "./pr-review-harness-extraction";
import type { PrReviewHarnessResult } from "./pr-review-harness-types";

const scope: DecisionScope = {
  surface: "pr_review",
  userId: "user-1",
  teamId: "team-1",
  repoId: "repo-1",
};

/** The shape of PR #615's clean review: one dense paragraph, no findings. */
const denseClean: PrReviewHarnessResult = {
  source: "structured",
  fallbackText: "PR #615 approved. Two suggestions are noted in the narrative.",
  reviewOutcome: {
    hasIssues: false,
    summary:
      "Approve-ready. postgres-claim.ts admits only shadow intents. claimFromRow still enforces credentials. runShadow never calls adapter.submit. Two non-blocking suggestions recorded in the review body.",
    commentBody: null,
    affectedFiles: [],
    findings: [],
  },
};

const withFinding: PrReviewHarnessResult = {
  source: "structured",
  fallbackText: null,
  reviewOutcome: {
    hasIssues: true,
    summary: "One warning. reportReview filed with hasIssues=true.",
    commentBody: "Restates the warning below.",
    affectedFiles: ["src/widget.ts"],
    findings: [
      {
        severity: "warning",
        title: "Guard nullable lookup",
        body: "lookup() can return undefined in src/widget.ts.",
        path: "src/widget.ts",
        line: 14,
      },
    ],
  },
};

const ENFORCED: Pick<DecisionHandle, "mode" | "status"> = {
  mode: "enforce",
  status: "ok",
};

function handle(
  id: DecisionId,
  act: boolean,
  answers = {},
  judged = ENFORCED
): DecisionHandle {
  return {
    id,
    ...judged,
    verdict: act ? "act" : "pass",
    act,
    escalated: false,
    answers,
    commit: async () => {},
  };
}

const flagged = {
  denseParagraph: { type: "boolean", probability: 0.95 },
  processTalk: { type: "boolean", probability: 0.1 },
  danglingReference: { type: "boolean", probability: 0.9 },
  bareCode: { type: "boolean", probability: 0.4 },
} as const;

function makeDeps(input: {
  formatActs: boolean;
  faithful?: boolean;
  rewrite?: PrReviewRewrite | Error | null;
  available?: boolean;
}) {
  const calls: Array<{
    id: DecisionId;
    state: unknown;
    scope: DecisionScope;
  }> = [];
  const rewrites: Array<{ problems: readonly string[] }> = [];
  const deps: PrReviewFormatDeps = {
    available: () => input.available ?? true,
    decide: async (id, state, callScope) => {
      calls.push({ id, state, scope: callScope });
      return id === "review_format"
        ? handle(id, input.formatActs, flagged)
        : handle(id, input.faithful ?? false);
    },
    rewrite: async ({ problems }) => {
      rewrites.push({ problems });
      if (input.rewrite instanceof Error) throw input.rewrite;
      return input.rewrite ? { rewrite: input.rewrite, usage: {} } : null;
    },
  };
  return { deps, calls, rewrites };
}

const cleanRewrite: PrReviewRewrite = {
  summary: "Safe to merge: only shadow intents are admitted.",
  commentBody:
    "- `postgres-claim.ts` admits only shadow intents.\n- `claimFromRow` still enforces credentials.",
  findingBodies: [],
};

describe("polishPrReviewForPublish", () => {
  it("should publish the faithful rewrite when the format check flags the text", async () => {
    const { deps, calls, rewrites } = makeDeps({
      formatActs: true,
      faithful: true,
      rewrite: cleanRewrite,
    });

    const published = await polishPrReviewForPublish(
      denseClean,
      scope,
      {},
      deps
    );

    expect(published?.reviewOutcome.summary).toBe(cleanRewrite.summary);
    expect(published?.reviewOutcome.commentBody).toBe(cleanRewrite.commentBody);
    expect(rewrites).toEqual([
      { problems: ["denseParagraph", "danglingReference"] },
    ]);
    expect(calls.map((call) => call.id)).toEqual([
      "review_format",
      "review_rewrite_faithful",
    ]);
    // The team's Run checks switch governs both calls.
    expect(calls.every((call) => call.scope.teamId === "team-1")).toBe(true);
    expect(calls[1]?.state).toMatchObject({
      rewritten: expect.stringContaining("`claimFromRow`"),
    });
  });

  it("should keep the reviewer's text when the rewrite is judged unfaithful", async () => {
    const { deps } = makeDeps({
      formatActs: true,
      faithful: false,
      rewrite: cleanRewrite,
    });

    const published = await polishPrReviewForPublish(
      denseClean,
      scope,
      {},
      deps
    );

    expect(published).toBe(denseClean);
  });

  it("should not rewrite text the format check passes", async () => {
    const { deps, rewrites } = makeDeps({ formatActs: false });

    const published = await polishPrReviewForPublish(
      denseClean,
      scope,
      {},
      deps
    );

    expect(published).toBe(denseClean);
    expect(rewrites).toHaveLength(0);
  });

  it("should keep finding titles, paths, and lines and drop a commentBody that findings supersede", async () => {
    const { deps } = makeDeps({
      formatActs: true,
      faithful: true,
      rewrite: {
        summary: "One warning in `src/widget.ts`.",
        commentBody: "- Restated.",
        findingBodies: ["`lookup()` can return `undefined`."],
      },
    });

    const published = await polishPrReviewForPublish(
      withFinding,
      scope,
      {},
      deps
    );

    expect(published?.reviewOutcome.commentBody).toBeNull();
    expect(published?.reviewOutcome.findings).toEqual([
      {
        ...withFinding.reviewOutcome.findings[0],
        body: "`lookup()` can return `undefined`.",
      },
    ]);
  });

  it("should discard a rewrite whose finding count does not match before judging it", async () => {
    const { deps, calls } = makeDeps({
      formatActs: true,
      faithful: true,
      rewrite: {
        summary: "One warning.",
        commentBody: null,
        findingBodies: [],
      },
    });

    const published = await polishPrReviewForPublish(
      withFinding,
      scope,
      {},
      deps
    );

    expect(published).toBe(withFinding);
    expect(calls.map((call) => call.id)).toEqual(["review_format"]);
  });

  it("should publish the original when the rewrite fails", async () => {
    const { deps } = makeDeps({
      formatActs: true,
      faithful: true,
      rewrite: new Error("gateway timeout"),
    });

    const published = await polishPrReviewForPublish(
      denseClean,
      scope,
      {},
      deps
    );

    expect(published).toBe(denseClean);
  });

  it("should ask nothing without a platform credential or a structured report", async () => {
    const unavailable = makeDeps({ formatActs: true, available: false });
    const legacy = makeDeps({ formatActs: true });

    await polishPrReviewForPublish(denseClean, scope, {}, unavailable.deps);
    await polishPrReviewForPublish(
      { ...denseClean, source: "legacy_text" },
      scope,
      {},
      legacy.deps
    );

    expect(unavailable.calls).toHaveLength(0);
    expect(legacy.calls).toHaveLength(0);
  });
});

describe("findReviewFormatProblems", () => {
  const judge = (
    judged: Pick<DecisionHandle, "mode" | "status">,
    act = false,
    available = true
  ) =>
    findReviewFormatProblems(
      denseClean,
      scope,
      {},
      {
        available: () => available,
        decide: async (id) => handle(id, act, flagged, judged),
      }
    );

  it("should name the problems of text it judged and flagged", async () => {
    await expect(
      judge({ mode: "enforce", status: "ok" }, true)
    ).resolves.toEqual(["denseParagraph", "danglingReference"]);
  });

  it("should pass text it judged and did not flag", async () => {
    await expect(judge({ mode: "enforce", status: "ok" })).resolves.toEqual([]);
  });

  it("should never report a pass for text it did not judge", async () => {
    await expect(
      judge({ mode: "enforce", status: "unavailable" })
    ).resolves.toBeNull();
    await expect(judge({ mode: "off", status: "off" })).resolves.toBeNull();
    await expect(judge({ mode: "shadow", status: "ok" })).resolves.toBeNull();
    await expect(
      judge({ mode: "enforce", status: "ok" }, false, false)
    ).resolves.toBeNull();
  });
});

describe("polishPrReviewForPublish and a review passed inside the run", () => {
  it("should publish it without checking it again", async () => {
    const { deps, calls } = makeDeps({ formatActs: true });
    const passed = { ...denseClean, formatPassed: true };

    await expect(
      polishPrReviewForPublish(passed, scope, {}, deps)
    ).resolves.toBe(passed);
    expect(calls).toEqual([]);
  });

  it("should read the pass from the reviewer's result", () => {
    const reported = {
      text: "Done.",
      steps: [
        {
          toolCalls: [
            {
              toolName: "reportReview",
              input: { hasIssues: false, summary: "Fine." },
            },
          ],
        },
      ],
    };

    expect(
      extractPrReviewHarnessResult({ ...reported, reviewFormatPassed: true })
        .formatPassed
    ).toBe(true);
    expect(extractPrReviewHarnessResult(reported).formatPassed).toBeUndefined();
  });
});

describe("what a clean structured review publishes", () => {
  it("should publish the report's summary and commentBody, never the closing chat message", () => {
    const harnessResult = extractPrReviewHarnessResult({
      text: "PR #615 approved. Two suggestions are noted in the review narrative.",
      steps: [
        {
          toolCalls: [
            {
              toolName: "reportReview",
              input: {
                hasIssues: false,
                summary: "Safe to merge.",
                commentBody: "- `claimFromRow` still enforces credentials.",
                findings: [],
              },
            },
          ],
          toolResults: [{}],
        },
      ],
    });

    const body = buildPrReviewTimelineCommentBody({
      harnessResult,
      fallbackText: "PR #615 approved.",
      conclusion: "success",
    });

    expect(body).toContain(
      "Safe to merge.\n\n- `claimFromRow` still enforces credentials."
    );
    expect(body).not.toContain("review narrative");
  });

  it("should keep every line of a multi-paragraph finding inside its bullet", () => {
    const body = buildPrReviewTimelineCommentBody({
      harnessResult: {
        ...withFinding,
        reviewOutcome: {
          ...withFinding.reviewOutcome,
          hasIssues: false,
          findings: [
            {
              severity: "suggestion",
              title: "Guard a zero-test CI run",
              body: "The job passes with no tests.\n\nFail when none ran.",
              path: null,
              line: null,
            },
          ],
        },
      },
      fallbackText: null,
      conclusion: "success",
    });

    expect(body).toContain(
      "**Suggestions**\n\n- **Guard a zero-test CI run**\n  The job passes with no tests.\n\n  Fail when none ran."
    );
  });
});

describe("finalizePrReviewSuccess and the format check", () => {
  it("should publish the checked text on the check run, the comment, and the stored findings", async () => {
    const seen: {
      check: Array<PrReviewHarnessResult | null>;
      comment: Array<PrReviewHarnessResult | null>;
      stored: unknown[];
      scope: DecisionScope | null;
    } = { check: [], comment: [], stored: [], scope: null };
    const polished: PrReviewHarnessResult = {
      ...denseClean,
      reviewOutcome: { ...denseClean.reviewOutcome, summary: "Safe to merge." },
    };
    const state = {
      reviewCheckRunId: 1,
      reviewCheckRunUrl: null,
      reviewCheckRunCompleted: false,
      reviewCheckRunConclusion: null,
      reviewCheckRunError: null,
      reviewTimelineCommentPublished: false,
      reviewTimelineCommentId: null,
      reviewTimelineCommentUrl: null,
      reviewTimelineCommentError: null,
      reviewGithubReviewPublished: false,
      reviewGithubReviewId: null,
      reviewGithubReviewUrl: null,
      reviewGithubReviewError: null,
      reviewGithubInlineCommentCount: 0,
      reviewStaleHeadCheckError: null,
      prReviewCompletionReason: null,
    } satisfies PrReviewReporterState;
    const ctx: FinalizePrReviewSuccessContext = {
      context: {
        metadata: {},
        assignmentType: "pr_review",
        skillId: null,
        agent: { model: "model", system_prompt: null },
        repo: {
          id: "repo-1",
          user_id: "user-1",
          full_name: "acme/widgets",
          product_team_id: "team-9",
        },
      } satisfies JobContext,
      reviewHeadSha: "abc123",
      reviewPrNumber: 7,
      state,
      loadCurrentPrReviewHeadSha: async () => "abc123",
      completeStalePrReviewCheckRun: async () => true,
      publishPrReviewCheckRun: async (input) => {
        seen.check.push(input.reviewHarnessResult);
        return true;
      },
      publishPrReviewGithubReview: async () => false,
      clearStalePrReviewTimelineComment: async () => true,
      publishPrReviewTimelineComment: async (input) => {
        seen.comment.push(input.reviewHarnessResult);
        return true;
      },
    };

    await finalizePrReviewSuccess(
      {
        jobRunId: "job-1",
        result: { text: "Done.", steps: [], usage: null },
        reviewHarnessResult: denseClean,
        reviewOutcome: denseClean.reviewOutcome,
        reviewCommentPosted: false,
        execution: null,
      },
      {
        persistJobReviewFindings: async ({ findings }) => {
          seen.stored.push(findings);
          return { persisted: true, count: findings.length, error: null };
        },
        polishPrReviewForPublish: async (harnessResult, decisionScope) => {
          seen.scope = decisionScope;
          return harnessResult === denseClean ? polished : harnessResult;
        },
      },
      ctx
    );

    expect(seen.check).toEqual([polished]);
    expect(seen.comment).toEqual([polished]);
    expect(seen.scope).toMatchObject({
      surface: "pr_review",
      userId: "user-1",
      teamId: "team-9",
      repoId: "repo-1",
    });
  });
});
