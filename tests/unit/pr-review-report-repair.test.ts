import assert from "node:assert/strict";
import type { AutomationAgentDeps } from "../../lib/workflows/automation-job-agent-runners-shared";
import test from "node:test";
import {
  loadAutomationJobWorkflowModule,
  makeStep,
  mockGithubPullRequestFetch,
} from "./helpers/automation-job-fixtures";

type Captured = {
  prompt?: string;
  messages?: Array<{ role: string; content: unknown }>;
  tools?: Record<string, { execute?: unknown }>;
  toolChoice?: unknown;
  stopWhen?: unknown;
};

const reviewContext = {
  metadata: { pr_number: 42 },
  assignmentType: "pr_review",
  skillId: null,
  agent: { model: "minimax/minimax-m2.5", system_prompt: null },
  repo: {
    id: "repo-123",
    user_id: "user-123",
    full_name: "acme/widgets",
    default_branch: "main",
    github_installation_id: 123,
  },
};

const FORGOT_TO_REPORT = {
  text: "Reviewed PR 42. One real problem: the retry path skips the check.",
  steps: [
    makeStep({
      text: "",
      inputTokens: 900,
      outputTokens: 40,
      toolCalls: [{ toolName: "getPullRequest", input: {} }],
      toolResults: [{}],
    }),
    makeStep({ text: "Reviewed PR 42.", inputTokens: 100, outputTokens: 60 }),
  ],
  totalUsage: { inputTokens: 1000, outputTokens: 100 },
  response: {
    messages: [{ role: "assistant", content: "Reviewed PR 42." }],
  },
};

const FILED_REPORT = {
  text: "",
  steps: [
    makeStep({
      inputTokens: 1100,
      outputTokens: 30,
      toolCalls: [
        {
          toolName: "reportReview",
          input: {
            hasIssues: true,
            summary: "The retry path skips the check.",
            findings: [
              {
                severity: "warning",
                title: "Retry path skips the check",
                body: "A replayed command is returned unchecked.",
                path: "lib/agents/tools/sandbox.ts",
              },
            ],
          },
        },
      ],
    }),
  ],
  totalUsage: { inputTokens: 1100, outputTokens: 30 },
};

async function runReview(
  replies: Array<unknown | Error>,
  judgeReviewFormat?: AutomationAgentDeps["judgeReviewFormat"]
) {
  const { createAutomationAgentRunner } =
    await loadAutomationJobWorkflowModule();
  const { extractPrReviewHarnessResult, isPrReviewVerdictMissing } =
    await import("../../lib/workflows/pr-review-harness");
  const calls: Captured[] = [];
  const mockedGithubFetch = mockGithubPullRequestFetch([42]);
  try {
    const runAutomationAgent = createAutomationAgentRunner({
      ...(judgeReviewFormat ? { judgeReviewFormat } : {}),
      generateText: async (input) => {
        calls.push(input as unknown as Captured);
        const reply = replies[calls.length - 1];
        if (reply instanceof Error) throw reply;
        return reply as never;
      },
    });
    const result = await runAutomationAgent(reviewContext, "github-token");
    const harness = extractPrReviewHarnessResult(result);
    return {
      calls,
      result,
      harness,
      verdictMissing: isPrReviewVerdictMissing(harness),
    };
  } finally {
    mockedGithubFetch.restore();
  }
}

test("a reviewer that forgot its report is asked once and the review gets its verdict", async () => {
  const { calls, result, harness, verdictMissing } = await runReview([
    FORGOT_TO_REPORT,
    FILED_REPORT,
  ]);

  assert.equal(calls.length, 2);
  assert.equal(harness.source, "structured");
  assert.equal(verdictMissing, false);
  assert.equal(harness.reviewOutcome.hasIssues, true);
  assert.equal(harness.reviewOutcome.findings.length, 1);
  // The reviewer's own closing text survives, and both calls are paid for.
  assert.equal(result.text, FORGOT_TO_REPORT.text);
  assert.deepEqual(result.usage, { inputTokens: 2100, outputTokens: 130 });
});

test("the follow-up can only file the report and ends without a step limit", async () => {
  const { calls } = await runReview([FORGOT_TO_REPORT, FILED_REPORT]);
  const followUp = calls[1];

  assert.deepEqual(Object.keys(followUp.tools ?? {}), ["reportReview"]);
  // No execute: the SDK returns once the model has filled the report in.
  assert.equal(followUp.tools?.reportReview.execute, undefined);
  assert.deepEqual(followUp.toolChoice, {
    type: "tool",
    toolName: "reportReview",
  });
  assert.equal(typeof followUp.stopWhen, "function");
  assert.equal((followUp.stopWhen as () => boolean)(), false);
  assert.equal(followUp.prompt, undefined);
  const roles = (followUp.messages ?? []).map((message) => message.role);
  assert.deepEqual(roles, ["user", "assistant", "user"]);
  assert.equal(followUp.messages?.[0].content, "Review PR #42.");
  assert.match(String(followUp.messages?.[2].content), /Call reportReview now/);
  // The first call still had the full review toolset, with a runnable report.
  assert.equal(typeof calls[0].tools?.reportReview.execute, "function");
  assert.ok("getPullRequest" in (calls[0].tools ?? {}));
});

test("a reviewer that filed its report is not asked again", async () => {
  const { calls, harness } = await runReview([FILED_REPORT]);

  assert.equal(calls.length, 1);
  assert.equal(harness.source, "structured");
});

test("an agent that never starts reviewing cannot become a clean review through report repair", async () => {
  const { calls, verdictMissing } = await runReview([
    {
      text: "MOGPLEX_FLOW_HANDOFF: review not started",
      steps: [makeStep({ text: "Review not started" })],
    },
    {
      text: "",
      steps: [
        makeStep({
          toolCalls: [
            {
              toolName: "reportReview",
              input: {
                hasIssues: false,
                summary: "No diff was available to review.",
              },
            },
          ],
        }),
      ],
    },
  ]);
  assert.equal(calls.length, 1);
  assert.equal(verdictMissing, true);
});

test("a failed follow-up leaves the finished review intact and without a verdict", async () => {
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const { calls, result, verdictMissing } = await runReview([
      FORGOT_TO_REPORT,
      new Error("model unavailable"),
    ]);

    assert.equal(calls.length, 2);
    assert.equal(result.text, FORGOT_TO_REPORT.text);
    assert.deepEqual(result.usage, { inputTokens: 1000, outputTokens: 100 });
    assert.equal(verdictMissing, true);
  } finally {
    console.warn = originalWarn;
  }
});

test("a reviewer that still does not report after being asked stays without a verdict", async () => {
  const { calls, verdictMissing } = await runReview([
    FORGOT_TO_REPORT,
    { text: "I already reviewed it.", steps: [makeStep({ text: "no" })] },
  ]);

  assert.equal(calls.length, 2);
  assert.equal(verdictMissing, true);
});

// What a thinking-only model's provider returned for the forced follow-up on
// webrenew/gtm-supahost#604.
function forcedToolChoiceRejected() {
  return Object.assign(
    new Error(
      "<400> InternalError.Algo.InvalidParameter: The value of the enable_thinking parameter is restricted to True."
    ),
    { statusCode: 400 }
  );
}

async function withQuietWarnings<T>(run: () => Promise<T>): Promise<T> {
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    return await run();
  } finally {
    console.warn = originalWarn;
  }
}

test("a provider that rejects a forced report is asked again without forcing and the review gets its verdict", async () => {
  const { calls, harness, verdictMissing } = await withQuietWarnings(() =>
    runReview([FORGOT_TO_REPORT, forcedToolChoiceRejected(), FILED_REPORT])
  );

  assert.equal(calls.length, 3);
  assert.deepEqual(calls[1].toolChoice, {
    type: "tool",
    toolName: "reportReview",
  });
  assert.equal(calls[2].toolChoice, "auto");
  // The unforced ask still offers nothing but the report, with no execute.
  assert.deepEqual(Object.keys(calls[2].tools ?? {}), ["reportReview"]);
  assert.equal(calls[2].tools?.reportReview.execute, undefined);
  assert.deepEqual(calls[2].messages, calls[1].messages);
  assert.equal(harness.source, "structured");
  assert.equal(verdictMissing, false);
  assert.equal(harness.reviewOutcome.hasIssues, true);
});

test("a follow-up that fails for any other reason is not asked again", async () => {
  const timedOut = Object.assign(new Error("Request timed out"), {
    name: "TimeoutError",
  });
  const { calls, verdictMissing } = await withQuietWarnings(() =>
    runReview([FORGOT_TO_REPORT, timedOut, FILED_REPORT])
  );

  assert.equal(calls.length, 2);
  assert.equal(verdictMissing, true);
});

test("a rejected forced report whose unforced ask also fails stays without a verdict", async () => {
  const { calls, result, verdictMissing } = await withQuietWarnings(() =>
    runReview([
      FORGOT_TO_REPORT,
      forcedToolChoiceRejected(),
      forcedToolChoiceRejected(),
    ])
  );

  assert.equal(calls.length, 3);
  assert.equal(result.text, FORGOT_TO_REPORT.text);
  assert.equal(verdictMissing, true);
});

const CLAIM = "One warning and three suggestions, detailed in the comment.";

// Webrenew/vmotif#1647: every report claimed issues without listing them, so
// the SDK rejected each one and nothing was ever filed.
const EVERY_REPORT_REJECTED = {
  text: "Reviewed PR 42.",
  steps: [
    makeStep({
      inputTokens: 900,
      outputTokens: 40,
      toolCalls: [
        {
          toolName: "reportReview",
          input: { hasIssues: true, summary: CLAIM },
          invalid: true,
        },
      ],
    }),
  ],
  totalUsage: { inputTokens: 900, outputTokens: 40 },
};

// Mogplex/mogplex#535: after the rejections, the reviewer flipped hasIssues
// to get a report accepted, and the findings were never listed anywhere.
const DROPPED_FINDINGS = {
  ...EVERY_REPORT_REJECTED,
  steps: [
    ...EVERY_REPORT_REJECTED.steps,
    makeStep({
      toolCalls: [
        {
          toolName: "reportReview",
          input: { hasIssues: false, summary: CLAIM },
        },
      ],
    }),
  ],
};

test("a reviewer whose every report was rejected is asked for its report", async () => {
  const { calls, harness, verdictMissing } = await runReview([
    EVERY_REPORT_REJECTED,
    FILED_REPORT,
  ]);

  assert.equal(calls.length, 2);
  assert.match(String(calls[1].messages?.[2].content), /Call reportReview now/);
  assert.equal(harness.source, "structured");
  assert.equal(verdictMissing, false);
});

test("a reviewer that dropped the findings it claimed is asked to list them", async () => {
  const { calls, harness, verdictMissing } = await runReview([
    DROPPED_FINDINGS,
    FILED_REPORT,
  ]);

  assert.equal(calls.length, 2);
  assert.match(
    String(calls[1].messages?.[2].content),
    /no report you filed lists them/
  );
  assert.equal(harness.source, "structured");
  assert.equal(verdictMissing, false);
  assert.equal(harness.reviewOutcome.findings.length, 1);
});

test("a reviewer that clears the review again without listing anything stays without a verdict", async () => {
  const clearedAgain = {
    text: "",
    steps: [
      makeStep({
        toolCalls: [
          {
            toolName: "reportReview",
            input: { hasIssues: false, summary: CLAIM },
          },
        ],
      }),
    ],
  };
  const { calls, harness, verdictMissing } = await runReview([
    DROPPED_FINDINGS,
    clearedAgain,
  ]);

  assert.equal(calls.length, 2);
  assert.equal(harness.source, "dropped_findings");
  assert.equal(verdictMissing, true);
});

test("a repair whose own report is rejected leaves the review without a verdict and is not asked again", async () => {
  const rejectedRepair = {
    text: "",
    steps: [
      makeStep({
        toolCalls: [
          {
            toolName: "reportReview",
            input: { hasIssues: true, summary: CLAIM },
            invalid: true,
          },
        ],
      }),
    ],
  };
  const { calls, harness, verdictMissing } = await runReview([
    DROPPED_FINDINGS,
    rejectedRepair,
    FILED_REPORT,
  ]);

  assert.equal(calls.length, 2);
  assert.equal(harness.source, "dropped_findings");
  assert.equal(verdictMissing, true);
});

test("a filed report the format check flags goes back to the reviewer, and its fix is published", async () => {
  const fixed = {
    ...FILED_REPORT,
    steps: [
      makeStep({
        toolCalls: [
          {
            toolName: "reportReview",
            input: {
              ...(FILED_REPORT.steps[0].toolCalls[0].input as Record<
                string,
                unknown
              >),
              summary: "The retry path in `sandbox.ts` skips the check.",
            },
          },
        ],
      }),
    ],
  };
  const judged: string[] = [];
  const { calls, harness, result } = await runReview(
    [FILED_REPORT, fixed],
    async (draft) => {
      judged.push(draft.reviewOutcome.summary);
      return draft.reviewOutcome.summary.includes("`") ? [] : ["bareCode"];
    }
  );

  assert.equal(calls.length, 2);
  assert.match(String(calls[1].messages?.at(-1)?.content), /backticks/);
  assert.deepEqual(Object.keys(calls[1].tools ?? {}), ["reportReview"]);
  assert.equal(
    harness.reviewOutcome.summary,
    "The retry path in `sandbox.ts` skips the check."
  );
  assert.equal(judged.length, 2);
  assert.equal(result.reviewFormatPassed, true);
});
