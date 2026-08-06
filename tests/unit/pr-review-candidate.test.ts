import assert from "node:assert/strict";
import test from "node:test";
import {
  createPrReviewCandidateGithubFetch,
  prReviewCandidateInputSchema,
  runPrReviewCandidate,
} from "../../lib/agents/pr-review-candidate";
import { buildPrReviewRunSpec } from "../../lib/agents/pr-review-run-spec";

const candidateInput = {
  schemaVersion: 1 as const,
  caseId: "missing-tenant-filter",
  suite: "pr-review" as const,
  input: {
    pullRequest: {
      title: "Add memory export",
      body: "Exports memories for the signed-in user.",
    },
    changedFiles: [
      {
        path: "app/api/memories/route.ts",
        patch: '+return admin.from("memories").select("*");',
        content: 'return admin.from("memories").select("*");',
      },
    ],
  },
};

test("candidate input rejects hidden labels", () => {
  assert.throws(() =>
    prReviewCandidateInputSchema.parse({
      ...candidateInput,
      expected: { findings: [] },
    })
  );
});

test("candidate GitHub transport serves only synthetic PR data", async () => {
  const candidate = prReviewCandidateInputSchema.parse(candidateInput);
  const request = createPrReviewCandidateGithubFetch(candidate);
  const pr = (await (
    await request(
      "https://api.github.com/repos/mogplex-quality/candidate/pulls/1"
    )
  ).json()) as { title: string };
  assert.equal(pr.title, "Add memory export");

  const file = (await (
    await request(
      "https://api.github.com/repos/mogplex-quality/candidate/contents/app/api/memories/route.ts?ref=quality-head"
    )
  ).json()) as { content: string };
  assert.equal(
    Buffer.from(file.content, "base64").toString("utf8"),
    'return admin.from("memories").select("*");'
  );

  await assert.rejects(
    request("https://example.com/customer-data"),
    /rejected https:\/\/example\.com/
  );
});

test("candidate reconstruction omits unified diff metadata", async () => {
  const candidate = prReviewCandidateInputSchema.parse({
    ...candidateInput,
    input: {
      ...candidateInput.input,
      changedFiles: [
        {
          path: "src/widget.ts",
          patch: [
            "--- a/src/widget.ts",
            "+++ b/src/widget.ts",
            "@@ -1 +1 @@",
            "-export const enabled = false;",
            "+export const enabled = true;",
            "\\ No newline at end of file",
          ].join("\n"),
        },
      ],
    },
  });
  const request = createPrReviewCandidateGithubFetch(candidate);
  const file = (await (
    await request(
      "https://api.github.com/repos/mogplex-quality/candidate/contents/src/widget.ts?ref=quality-head"
    )
  ).json()) as { content: string };
  const content = Buffer.from(file.content, "base64").toString("utf8");
  assert.match(content, /export const enabled = true/);
  assert.doesNotMatch(content, /\+\+\+|---|@@|No newline/);
});

test("candidate runner returns the structured production review contract", async () => {
  const result = await runPrReviewCandidate(candidateInput, {
    model: "test/model",
    modelId: "test/model",
    generateText: (async (request) => {
      const tools = request.tools as unknown as Record<
        string,
        { execute: (input: unknown, options: unknown) => Promise<unknown> }
      >;
      const pullRequest = await tools.getPullRequest?.execute({}, {});
      assert.deepEqual(pullRequest, {
        number: 1,
        title: "Add memory export",
        body: "Exports memories for the signed-in user.",
        url: "https://github.invalid/mogplex-quality/candidate/pull/1",
        headRef: "quality-head",
        headSha: "1".repeat(40),
        baseRef: "main",
        baseSha: "0".repeat(40),
      });
      return {
        text: "One material issue found.",
        steps: [
          {
            text: "",
            toolCalls: [
              {
                toolName: "reportReview",
                input: {
                  hasIssues: true,
                  summary: "One material issue found.",
                  affectedFiles: ["app/api/memories/route.ts"],
                  findings: [
                    {
                      severity: "critical",
                      title: "Restore tenant isolation",
                      body: "The service-role query has no user_id filter.",
                      path: "app/api/memories/route.ts",
                    },
                  ],
                },
              },
            ],
            toolResults: [],
            usage: { inputTokens: 12, outputTokens: 8 },
          },
        ],
        totalUsage: { inputTokens: 12, outputTokens: 8 },
        providerMetadata: {},
      } as never;
    }) as typeof import("ai").generateText,
  });

  assert.equal(result.caseId, "missing-tenant-filter");
  assert.equal(result.hasIssues, true);
  assert.equal(result.findings[0]?.severity, "critical");
  assert.equal(result.metadata.inputTokens, 12);
  assert.equal(result.metadata.execution.phase, "quality_pr_review");
});

test("PR review run spec keeps static production instructions", () => {
  const spec = buildPrReviewRunSpec({
    prNumber: 42,
    systemPrompt: "Review carefully.",
  });
  assert.match(spec.system, /Always call reportReview exactly once/);
  assert.equal(spec.prompt, "Review PR #42.");
});

test("PR review run spec preserves legacy metadata rendering", () => {
  assert.equal(
    buildPrReviewRunSpec({ prNumber: undefined }).prompt,
    "Review PR #undefined."
  );
});
