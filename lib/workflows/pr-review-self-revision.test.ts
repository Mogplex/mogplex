import { tool } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ReviewFormatProblem } from "@/lib/decisions/definitions";
import type { AutomationAgentResult } from "./automation-job-types";
import { extractPrReviewHarnessResult } from "./pr-review-harness-extraction";
import type { PrReviewHarnessResult } from "./pr-review-harness-types";
import type { ReportRepairRequest } from "./pr-review-report-repair";
import {
  finishPrReview,
  REVIEW_FORMAT_FEEDBACK,
  reviseFlaggedReview,
} from "./pr-review-self-revision";

const warning = {
  severity: "warning",
  title: "Guard nullable lookup",
  body: "`lookup()` can return undefined.",
  path: "src/widget.ts",
};
const suggestion = {
  severity: "suggestion",
  title: "Name the retry budget",
  body: "The 3 in `retry()` is a magic number.",
  path: "src/retry.ts",
};

function reported(input: Record<string, unknown>): AutomationAgentResult {
  return {
    text: "Reviewed.",
    steps: [{ toolCalls: [{ toolName: "reportReview", input }] }],
    usage: null,
  };
}

/** The #535 draft: it mentions suggestions it never lists. */
const danglingDraft = reported({
  hasIssues: false,
  summary: "Approve. Three minor suggestions, detailed in the comment.",
});

const listedRevision = reported({
  hasIssues: false,
  summary: "Approve. Three minor suggestions follow.",
  findings: [suggestion],
});

type Judged = { summary: string; findings: number };

/** A judge that flags the given problems for any review whose summary matches. */
function judgeFlagging(
  flagged: RegExp,
  problems: ReviewFormatProblem[] = ["danglingReference"]
) {
  const judged: Judged[] = [];
  const judge = async (harnessResult: PrReviewHarnessResult) => {
    judged.push({
      summary: harnessResult.reviewOutcome.summary,
      findings: harnessResult.reviewOutcome.findings.length,
    });
    return flagged.test(harnessResult.reviewOutcome.summary) ? problems : [];
  };
  return { judge, judged };
}

function reviewer(answers: Array<AutomationAgentResult | Error>) {
  const requests: ReportRepairRequest[] = [];
  const generate = async (request: ReportRepairRequest) => {
    requests.push(request);
    const answer = answers[requests.length - 1];
    if (!answer || answer instanceof Error) {
      throw answer ?? new Error("no scripted answer");
    }
    return answer;
  };
  return { generate, requests };
}

const followUp = {
  responseMessages: undefined,
  prompt: "Review PR #42.",
  tools: {
    reportReview: tool({
      inputSchema: z.object({ hasIssues: z.boolean() }),
      execute: async (input) => input,
    }),
  },
};

function published(result: AutomationAgentResult) {
  return extractPrReviewHarnessResult(result).reviewOutcome;
}

describe("reviseFlaggedReview", () => {
  it("should mark a draft the format check passes without asking the reviewer anything", async () => {
    const { judge } = judgeFlagging(/never/);
    const { generate, requests } = reviewer([]);

    const result = await reviseFlaggedReview({
      ...followUp,
      result: danglingDraft,
      generate,
      judge,
    });

    expect(requests).toEqual([]);
    expect(result.reviewFormatPassed).toBe(true);
  });

  it("should have the reviewer fix a flagged draft in its own conversation and publish its revision", async () => {
    const { judge, judged } = judgeFlagging(/detailed in the comment/);
    const { generate, requests } = reviewer([listedRevision]);

    const result = await reviseFlaggedReview({
      ...followUp,
      result: danglingDraft,
      generate,
      judge,
    });

    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(Object.keys(request.tools)).toEqual(["reportReview"]);
    expect(request.messages[0]).toEqual({
      role: "user",
      content: "Review PR #42.",
    });
    const ask = String(request.messages.at(-1)?.content);
    expect(ask).toContain(REVIEW_FORMAT_FEEDBACK.danglingReference);
    expect(ask).toContain("detailed in the comment");
    expect(published(result).findings).toHaveLength(1);
    expect(published(result).summary).toBe(
      "Approve. Three minor suggestions follow."
    );
    // The revision was judged too, and it passed.
    expect(judged.map((entry) => entry.findings)).toEqual([0, 1]);
    expect(result.reviewFormatPassed).toBe(true);
  });

  it("should publish a revision the check still flags without marking it passed", async () => {
    const { judge } = judgeFlagging(/suggestions/);
    const { generate } = reviewer([listedRevision]);

    const result = await reviseFlaggedReview({
      ...followUp,
      result: danglingDraft,
      generate,
      judge,
    });

    expect(published(result).findings).toHaveLength(1);
    expect(result.reviewFormatPassed).toBeUndefined();
  });

  it("should keep the draft when the revision drops a finding", async () => {
    const draft = reported({
      hasIssues: true,
      summary: "One warning; reportReview filed.",
      findings: [warning, suggestion],
    });
    const { judge } = judgeFlagging(/reportReview/, ["processTalk"]);
    const { generate } = reviewer([
      reported({
        hasIssues: true,
        summary: "One warning.",
        findings: [warning],
      }),
    ]);

    const result = await reviseFlaggedReview({
      ...followUp,
      result: draft,
      generate,
      judge,
    });

    expect(result).toBe(draft);
  });

  it("should keep the draft when the revision clears the issues it reported", async () => {
    const draft = reported({
      hasIssues: true,
      summary: "One warning; reportReview filed.",
      findings: [warning],
    });
    const { judge } = judgeFlagging(/reportReview/, ["processTalk"]);
    const { generate } = reviewer([
      reported({ hasIssues: false, summary: "Fine." }),
    ]);

    const result = await reviseFlaggedReview({
      ...followUp,
      result: draft,
      generate,
      judge,
    });

    expect(result).toBe(draft);
  });

  it("should keep the draft when the revised report is rejected", async () => {
    const { judge } = judgeFlagging(/detailed/);
    const { generate } = reviewer([
      {
        text: "",
        steps: [
          {
            toolCalls: [
              {
                toolName: "reportReview",
                input: { hasIssues: true, summary: "Three suggestions." },
                invalid: true,
              },
            ],
          },
        ],
        usage: null,
      },
    ]);

    const result = await reviseFlaggedReview({
      ...followUp,
      result: danglingDraft,
      generate,
      judge,
    });

    expect(result).toBe(danglingDraft);
  });

  it("should keep the draft when the reviewer cannot be asked or the check fails", async () => {
    const { judge } = judgeFlagging(/detailed/);
    const failing = reviewer([new Error("model unavailable")]);
    const throwingJudge = async () => {
      throw new Error("evaluator down");
    };

    const afterModelError = await reviseFlaggedReview({
      ...followUp,
      result: danglingDraft,
      generate: failing.generate,
      judge,
    });
    const afterJudgeError = await reviseFlaggedReview({
      ...followUp,
      result: danglingDraft,
      generate: reviewer([]).generate,
      judge: throwingJudge,
    });

    expect(afterModelError).toBe(danglingDraft);
    expect(afterJudgeError).toBe(danglingDraft);
  });

  it("should leave a review without a trusted report to the incomplete path", async () => {
    const { judge, judged } = judgeFlagging(/./);
    const unreported: AutomationAgentResult = {
      text: "Reviewed.",
      steps: [],
      usage: null,
    };

    const result = await reviseFlaggedReview({
      ...followUp,
      result: unreported,
      generate: reviewer([]).generate,
      judge,
    });

    expect(result).toBe(unreported);
    expect(judged).toEqual([]);
  });
});

describe("finishPrReview", () => {
  it("should file a missing report first and then check the report it got", async () => {
    const { judge, judged } = judgeFlagging(/detailed in the comment/);
    const { generate, requests } = reviewer([danglingDraft, listedRevision]);

    const result = await finishPrReview({
      ...followUp,
      result: { text: "Reviewed.", steps: [], usage: null },
      generate,
      judge,
    });

    expect(requests).toHaveLength(2);
    expect(String(requests[0].messages.at(-1)?.content)).toMatch(
      /without calling reportReview/
    );
    expect(String(requests[1].messages.at(-1)?.content)).toContain(
      REVIEW_FORMAT_FEEDBACK.danglingReference
    );
    expect(judged).toHaveLength(2);
    expect(published(result).findings).toHaveLength(1);
    expect(result.reviewFormatPassed).toBe(true);
  });
});
