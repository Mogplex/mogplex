import assert from "node:assert/strict";
import test from "node:test";
import { loadAutomationJobWorkflowModule } from "./helpers/automation-job-fixtures";

test("resolveSlackTriggerDestination replies in the triggering thread", async () => {
  const { resolveSlackTriggerDestination } =
    await loadAutomationJobWorkflowModule();

  assert.deepEqual(
    resolveSlackTriggerDestination({
      slack: {
        team_id: " T123 ",
        channel_id: " C123 ",
        thread_ts: " 1721000000.000001 ",
        message_ts: "1721000000.000002",
      },
    }),
    {
      teamId: "T123",
      channelId: "C123",
      threadTs: "1721000000.000001",
    }
  );
  assert.deepEqual(
    resolveSlackTriggerDestination({
      slack: {
        team_id: "T123",
        channel_id: "C123",
        message_ts: "1721000000.000002",
      },
    }),
    {
      teamId: "T123",
      channelId: "C123",
      threadTs: "1721000000.000002",
    }
  );
});

test("resolveSlackTriggerDestination requires Slack event context", async () => {
  const { resolveSlackTriggerDestination } =
    await loadAutomationJobWorkflowModule();

  assert.throws(
    () =>
      resolveSlackTriggerDestination({
        slack: {
          team_id: "T123",
          channel_id: "C123",
        },
      }),
    /requires a Slack-triggered workflow event/
  );
});

test("Claude Code review prompts require a structured Mogplex verdict", async () => {
  const { buildAutomationHarnessPrompt } =
    await loadAutomationJobWorkflowModule();

  const prompt = buildAutomationHarnessPrompt({
    harnessId: "claude-code",
    context: {
      metadata: {
        flow_node_role: "review",
        pr_number: 42,
      },
      assignmentType: "pr_review",
      skillId: null,
      agent: {
        model: "harness:claude-code",
        system_prompt: "Focus on correctness.",
      },
      repo: {
        id: "repo-123",
        user_id: "user-123",
        full_name: "acme/widgets",
        default_branch: "main",
        github_installation_id: 123,
      },
    },
  });

  assert.match(prompt, /Claude Code running a Mogplex automation/);
  assert.match(prompt, /Inspect only/);
  assert.match(prompt, /MOGPLEX_REVIEW_RESULT:/);
  assert.match(prompt, /Do not edit files, push commits, merge/);
});

test("parseAutomationHarnessReviewResult reads the final structured verdict", async () => {
  const { parseAutomationHarnessReviewResult } =
    await loadAutomationJobWorkflowModule();
  const text = [
    "Inspected the changed files.",
    'MOGPLEX_REVIEW_RESULT: {"hasIssues":true,"summary":"One correctness issue.","commentBody":null,"affectedFiles":["src/widget.ts"],"findings":[{"severity":"warning","title":"Null case is dropped","body":"Preserve the null result before rendering.","path":"src/widget.ts","line":42}]}',
  ].join("\n");

  assert.deepEqual(parseAutomationHarnessReviewResult(text), {
    hasIssues: true,
    summary: "One correctness issue.",
    commentBody: null,
    affectedFiles: ["src/widget.ts"],
    findings: [
      {
        severity: "warning",
        title: "Null case is dropped",
        body: "Preserve the null result before rendering.",
        path: "src/widget.ts",
        line: 42,
      },
    ],
  });
  assert.equal(
    parseAutomationHarnessReviewResult("Review finished without a verdict."),
    null
  );
  assert.equal(
    parseAutomationHarnessReviewResult(
      'MOGPLEX_REVIEW_RESULT: {"hasIssues":true,"summary":"Issues found.","findings":[]}'
    ),
    null
  );
  assert.equal(
    parseAutomationHarnessReviewResult(
      'MOGPLEX_REVIEW_RESULT: {"hasIssues":true,"summary":"Issues found.","findings":[{"severity":"warning"}]}'
    ),
    null
  );
});
