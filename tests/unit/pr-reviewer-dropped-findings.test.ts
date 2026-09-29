import assert from "node:assert/strict";
import test from "node:test";
import type { z } from "zod";

type ReviewTools = ReturnType<
  Awaited<typeof import("../../lib/agents/pr-reviewer")>["buildPRReviewTools"]
>;
type Executable = {
  inputSchema: z.ZodType;
  execute: (input: unknown) => Promise<Record<string, unknown>>;
};

const CLAIM = "One warning and three suggestions, none blocking.";

async function buildTools(fetch: typeof globalThis.fetch) {
  const { buildPRReviewTools } = await import("../../lib/agents/pr-reviewer");
  return buildPRReviewTools({
    fetch,
    githubToken: "github-token",
    owner: "acme",
    repo: "widgets",
    prNumber: 42,
    allowPrLifecycle: true,
  });
}

function toolOf(tools: ReviewTools, name: string) {
  return (tools as unknown as Record<string, Executable>)[name];
}

/** What the SDK does with a report: validate, then run it only if valid. */
async function fileReport(tools: ReviewTools, input: Record<string, unknown>) {
  const report = toolOf(tools, "reportReview");
  const parsed = report.inputSchema.safeParse(input);
  if (parsed.success) await report.execute(parsed.data);
  return parsed.success;
}

/** GitHub reports the PR closed, so a merge attempt stops after one read. */
function recordGithubRequests() {
  const urls: string[] = [];
  const fetch = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return new Response(JSON.stringify({ state: "closed" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof globalThis.fetch;
  return { urls, fetch };
}

for (const name of ["mergePullRequest", "queuePullRequestForMerge"]) {
  test(`${name} refuses a review that dropped the issues it claimed`, async () => {
    const github = recordGithubRequests();
    const tools = await buildTools(github.fetch);
    assert.equal(
      await fileReport(tools, { hasIssues: true, summary: CLAIM }),
      false
    );
    assert.equal(
      await fileReport(tools, { hasIssues: false, summary: CLAIM }),
      true
    );

    const outcome = await toolOf(tools, name).execute({});

    assert.equal(outcome.success, false);
    assert.match(String(outcome.error), /lists none/);
    assert.deepEqual(github.urls, []);
  });

  test(`${name} refuses a review whose every issue report was rejected`, async () => {
    const github = recordGithubRequests();
    const tools = await buildTools(github.fetch);
    assert.equal(
      await fileReport(tools, { hasIssues: true, summary: CLAIM }),
      false
    );

    const outcome = await toolOf(tools, name).execute({});

    assert.equal(outcome.success, false);
    assert.deepEqual(github.urls, []);
  });

  test(`${name} refuses after an issue report the base schema rejected`, async () => {
    const github = recordGithubRequests();
    const tools = await buildTools(github.fetch);
    const malformed = {
      hasIssues: true,
      summary: CLAIM,
      findings: [{ severity: "blocker", title: "Retry", body: "Unchecked." }],
    };
    assert.equal(await fileReport(tools, malformed), false);
    assert.equal(
      await fileReport(tools, { hasIssues: false, summary: CLAIM }),
      true
    );

    const outcome = await toolOf(tools, name).execute({});

    assert.equal(outcome.success, false);
    assert.deepEqual(github.urls, []);
  });

  test(`${name} proceeds before any report when nothing claimed issues`, async () => {
    const github = recordGithubRequests();
    const tools = await buildTools(github.fetch);

    await toolOf(tools, name).execute({});

    assert.ok(github.urls.some((url) => url.endsWith("/pulls/42")));
  });

  test(`${name} proceeds when the clean report lists its suggestions`, async () => {
    const github = recordGithubRequests();
    const tools = await buildTools(github.fetch);
    await fileReport(tools, { hasIssues: true, summary: CLAIM });
    await fileReport(tools, {
      hasIssues: false,
      summary: CLAIM,
      findings: [
        { severity: "suggestion", title: "Name the budget", body: "Magic 3." },
      ],
    });

    await toolOf(tools, name).execute({});

    assert.ok(github.urls.some((url) => url.endsWith("/pulls/42")));
  });
}

test("the rejection tells the reviewer to list the findings, not to clear the review", async () => {
  const tools = await buildTools(recordGithubRequests().fetch);
  const parsed = toolOf(tools, "reportReview").inputSchema.safeParse({
    hasIssues: true,
    summary: CLAIM,
  });

  assert.equal(parsed.success, false);
  assert.match(
    String(parsed.error),
    /Setting hasIssues=false without listing the issues leaves the review without a verdict/
  );
});

test("the report schema the model sees still requires a summary and names every severity", async () => {
  const { asSchema } = await import("ai");
  const tools = await buildTools(recordGithubRequests().fetch);
  const schema = (await asSchema(toolOf(tools, "reportReview").inputSchema)
    .jsonSchema) as {
    required?: string[];
    properties: {
      findings: { items: { properties: Record<string, unknown> } };
    };
  };

  assert.deepEqual(schema.required, ["hasIssues", "summary"]);
  assert.deepEqual(schema.properties.findings.items.properties.severity, {
    type: "string",
    enum: ["critical", "warning", "suggestion"],
  });
});
