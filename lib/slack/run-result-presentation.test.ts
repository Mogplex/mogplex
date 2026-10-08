import { expect, it } from "vitest";
import { stripSlackRunControlsForTerminalRun } from "./run-controls-notify";
import type { PostSlackMessageInput, UpdateSlackMessageInput } from "./client";
import { emptyRunResultEvidence } from "./run-result-evidence";
import { createRunProgressState, applyRunProgress } from "./run-progress-state";
import { serializeRunProgress } from "./run-progress-store";
import { buildRunResultMessage } from "./run-result-presentation";

process.env.NEXT_PUBLIC_APP_URL ||= "https://mogplex.com";

it("starts a long report at its beginning and labels a word-bounded excerpt", () => {
  const message = buildRunResultMessage({
    run,
    status: "success",
    output:
      "The requested fix is complete. " + "Verification passed. ".repeat(150),
    evidence: emptyRunResultEvidence(),
    guidance: [],
  });
  expect(message.text).toContain(
    "*Agent’s closing report (excerpt)*\nThe requested fix is complete."
  );
  const report = message.blocks.find(
    (block) =>
      block.type === "section" &&
      JSON.stringify(block).includes("Agent’s closing report")
  );
  expect(JSON.stringify(report)).toMatch(/(?:Verification|passed\.)…/);
});

it("uses the latest durable update for an interrupted run instead of its early activity log", () => {
  const state = createRunProgressState(1000);
  state.summary = "The build failed; verification is unfinished.";
  const message = buildRunResultMessage({
    run: { ...run, slack_progress: serializeRunProgress(state) },
    status: "failed",
    output: "I will inspect the repository.",
    evidence: emptyRunResultEvidence(),
    guidance: [],
  });
  expect(message.text).toContain(
    "*Last agent update*\nThe build failed; verification is unfinished."
  );
  expect(message.text).not.toContain("I will inspect the repository.");
});

it("redacts complete output before taking its tail so truncation cannot expose a partial credential", () => {
  const output = "Token: sk-" + "secret-fixture".repeat(160) + " Finished.";
  const message = buildRunResultMessage({
    run,
    status: "success",
    output,
    evidence: emptyRunResultEvidence(),
    guidance: [],
  });
  expect(message.text).not.toContain("secret-fixture");
  expect(message.text).toContain("Finished.");
});
const run = {
  id: "run-1",
  prompt: "Fix the mobile controls",
  working_branch: "fix/mobile",
  metadata: {
    slackRunControls: { teamId: "T1", channelId: "C1", messageTs: "1.2" },
  } as Record<string, unknown>,
};
async function deliver(
  status: "success" | "failed" | "cancelled",
  changes: Partial<typeof run> & { slack_progress?: unknown } = {},
  evidence = emptyRunResultEvidence(),
  options: { announce?: boolean } = {}
) {
  const updates: UpdateSlackMessageInput[] = [];
  const posts: PostSlackMessageInput[] = [];
  await stripSlackRunControlsForTerminalRun(
    { ...run, ...changes },
    status,
    {
      getSlackBotToken: async () => "fixture-token",
      updateSlackMessage: async (_token, message) => {
        updates.push(message);
      },
      postSlackMessage: async (_token, message) => {
        posts.push(message);
      },
      loadRunOutput: async () =>
        "Changed the header. Tests passed. https://github.com/other/app/pull/99 <!channel>",
      loadEvidence: async () => evidence,
    },
    options
  );
  return { update: updates[0], posts };
}

async function render(
  status: "success" | "failed" | "cancelled",
  changes: Partial<typeof run> & { slack_progress?: unknown } = {},
  evidence = emptyRunResultEvidence()
) {
  return (await deliver(status, changes, evidence)).update;
}

it("leads with the task and separates the agent report from verified artifacts", async () => {
  const message = await render("success");
  expect(message.blocks?.[0]).toEqual({
    type: "header",
    text: { type: "plain_text", text: run.prompt },
  });
  expect(message.text).toContain("Agent’s closing report");
  expect(message.text).toContain("Could not verify GitHub artifacts");
  expect(message.text).toContain(
    "No completed test or build result was recorded"
  );
  expect(JSON.stringify(message.blocks)).not.toContain("<!channel>");
  expect(JSON.stringify(message.blocks)).not.toContain(
    '"url":"https://github.com/other/app/pull/99"'
  );
});

it.each(["failed", "cancelled"] as const)(
  "preserves partial progress on %s and offers inspection without replay",
  async (status) => {
    const message = await render(
      status,
      {},
      {
        github: {
          checked: true,
          branch: {
            sha: "a".repeat(40),
            url: "https://github.com/acme/app/tree/" + "a".repeat(40),
          },
          pullRequests: [],
        },
        workspace: {
          status: "paused",
          persistent: true,
          snapshotRecorded: true,
        },
      }
    );
    expect(message.text).toContain("Last agent update");
    expect(message.text).toContain("Changed the header");
    expect(message.text).toContain("Remote branch verified");
    expect(message.text).toContain("Uncommitted changes are not included");
    expect(message.text).toContain("contents have not been checked");
    expect(JSON.stringify(message.blocks)).not.toContain("mogplex-cancel-run");
    expect(JSON.stringify(message.blocks)).not.toContain("Resume run");
  }
);

it("reports actual check exits without turning a finished command into passed tests", async () => {
  const state = createRunProgressState(1000);
  applyRunProgress(
    state,
    {
      kind: "tool_started",
      toolName: "terminal_exec",
      toolCallId: "test-1",
      input: { command: "pnpm test" },
    },
    1000
  );
  applyRunProgress(
    state,
    {
      kind: "tool_finished",
      toolName: "terminal_exec",
      toolCallId: "test-1",
      state: "success",
      output: { exitCode: 1 },
    },
    2000
  );
  const message = await render("success", {
    slack_progress: serializeRunProgress(state),
  });
  expect(message.text).toContain("exited with code 1");
  expect(message.text).toContain("Recorded checks");
});

it("renders verified artifact navigation and guidance in the Slack blocks", () => {
  const prUrl = "https://github.com/acme/app/pull/42";
  const message = buildRunResultMessage({
    run,
    status: "success",
    output: "Changed the header.",
    evidence: {
      github: {
        checked: true,
        branch: null,
        pullRequests: [{ number: 42, state: "open", url: prUrl }],
      },
      workspace: { status: "paused", persistent: true, snapshotRecorded: true },
    },
    guidance: [
      {
        id: "g1",
        run_id: run.id,
        user_id: "u1",
        ai_call_id: "a1",
        body: "Keep desktop unchanged",
        status: "delivered",
        delivered_step: 1,
        attachments: null,
        created_at: new Date(0).toISOString(),
      },
    ],
  });
  expect(message.blocks).toContainEqual({
    type: "section",
    text: { type: "mrkdwn", text: `*Artifacts*\nPR #42 · open\n${prUrl}` },
  });
  expect(message.blocks).toContainEqual({
    type: "section",
    text: {
      type: "mrkdwn",
      text: "*Your guidance*\nSupplied to agent step 2: Keep desktop unchanged",
    },
  });
  expect(message.blocks.find((block) => block.type === "actions")).toEqual({
    type: "actions",
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: "Review pull request" },
        url: prUrl,
        action_id: "mogplex-view-pr",
      },
      {
        type: "button",
        text: { type: "plain_text", text: "View run details" },
        url: `${process.env.NEXT_PUBLIC_APP_URL}/runs/run-1?view=details`,
        action_id: "mogplex-view-run",
      },
      {
        type: "button",
        text: { type: "plain_text", text: "Inspect workspaces" },
        url: `${process.env.NEXT_PUBLIC_APP_URL}/sandboxes`,
        action_id: "mogplex-view-workspaces",
      },
    ],
  });
  expect(JSON.stringify(message.blocks)).toContain("a snapshot is recorded");
  expect(JSON.stringify(message.blocks)).toContain("with persistent storage");
});

it("offers only verified branch navigation and keeps missing-work recovery explicit", () => {
  const evidence = emptyRunResultEvidence();
  evidence.github = {
    checked: true,
    branch: {
      sha: "a".repeat(40),
      url: "https://github.com/acme/app/tree/" + "a".repeat(40),
    },
    pullRequests: [],
  };
  const state = createRunProgressState(1000);
  state.summary = "Inspected the header; edits are unfinished.";
  const message = buildRunResultMessage({
    run: { ...run, slack_progress: serializeRunProgress(state) },
    status: "failed",
    output: null,
    evidence,
    guidance: [],
  });
  expect(message.blocks).toContainEqual({
    type: "section",
    text: {
      type: "mrkdwn",
      text: "*Last agent update*\nInspected the header; edits are unfinished.",
    },
  });
  expect(message.text).toContain(
    "No pull request was found for this working branch."
  );
  expect(JSON.stringify(message.blocks)).toContain(
    "No recoverable workspace has been verified."
  );
  expect(
    message.blocks.find((block) => block.type === "actions")
  ).toMatchObject({
    elements: [
      { action_id: "mogplex-view-branch", url: evidence.github.branch?.url },
      {
        action_id: "mogplex-view-run",
        url: `${process.env.NEXT_PUBLIC_APP_URL}/runs/run-1?view=details`,
      },
    ],
  });
  expect(JSON.stringify(message.blocks)).not.toContain("mogplex-view-pr");
  expect(JSON.stringify(message.blocks)).not.toContain(
    "mogplex-view-workspaces"
  );
});

it("renders the agent's Markdown report as Slack formatting with its line breaks", () => {
  const message = buildRunResultMessage({
    run,
    status: "success",
    output:
      "## Summary\n- **Fixed** the `agent-loop` timeout\n- See [PR #7](https://github.com/acme/app/pull/7)",
    evidence: emptyRunResultEvidence(),
    guidance: [],
  });
  expect(message.blocks).toContainEqual({
    type: "section",
    text: {
      type: "mrkdwn",
      text: "*Agent’s closing report*\n*Summary*\n• *Fixed* the `agent-loop` timeout\n• See PR #7 (https://github.com/acme/app/pull/7)",
    },
  });
  expect(JSON.stringify(message.blocks)).not.toContain("**");
});

it("announces a finished run in its thread, because an edit sends no notification", async () => {
  const prUrl = "https://github.com/acme/app/pull/42";
  const { posts } = await deliver(
    "success",
    {
      metadata: {
        slack_user_id: "U123",
        slackRunControls: {
          teamId: "T1",
          channelId: "C1",
          messageTs: "1.2",
          threadTs: "1.1",
        },
      },
    },
    {
      github: {
        checked: true,
        branch: null,
        pullRequests: [{ number: 42, state: "open", url: prUrl }],
      },
      workspace: null,
    },
    { announce: true }
  );
  expect(posts).toEqual([
    {
      channel: "C1",
      thread_ts: "1.1",
      text: `<@U123> *✅ Run finished:* Fix the mobile controls\nPull request #42 (open): ${prUrl}\nFull report is on the run message above · <${process.env.NEXT_PUBLIC_APP_URL}/runs/run-1?view=details|View run>`,
    },
  ]);
});

it("says why a failed run stopped and keeps agent text inert", async () => {
  const state = createRunProgressState(1000);
  state.summary = "Tests timed out <!channel>";
  const { posts } = await deliver(
    "failed",
    { slack_progress: serializeRunProgress(state) },
    emptyRunResultEvidence(),
    { announce: true }
  );
  expect(posts[0]?.thread_ts).toBeUndefined();
  expect(posts[0]?.text).toContain("*❌ Run failed:* Fix the mobile controls");
  expect(posts[0]?.text).toContain("Last update: Tests timed out");
  expect(posts[0]?.text).not.toContain("<!channel>");
});

it("does not announce a refreshed terminal message twice", async () => {
  const { update, posts } = await deliver("success");
  expect(update).toBeDefined();
  expect(posts).toEqual([]);
});

it("keeps a report whose escaping multiplies its length within Slack’s limits", () => {
  const message = buildRunResultMessage({
    run,
    status: "success",
    output: `Rendered markup:\n${"<a>&amp;</a> ".repeat(120)}`,
    evidence: emptyRunResultEvidence(),
    guidance: [],
  });
  const report = message.blocks.find((block) =>
    JSON.stringify(block).includes("Agent’s closing report")
  ) as { text: { text: string } };
  expect(report.text.text).toContain("(excerpt)");
  expect(report.text.text.length).toBeLessThanOrEqual(3000);
  expect(message.text.length).toBeLessThanOrEqual(4000);
});

it.each([
  {
    type: "mpim",
    id: "G123",
    expectMention: false,
    desc: "group DM skips mention",
  },
  {
    type: "channel",
    id: "G123",
    expectMention: true,
    desc: "channel includes mention",
  },
  {
    type: undefined,
    id: "D123",
    expectMention: false,
    desc: "D prefix fallback",
  },
] as const)("channelType: $desc", async ({ type, id, expectMention }) => {
  const { posts } = await deliver(
    "success",
    {
      metadata: {
        slack_user_id: "U123",
        slackRunControls: {
          teamId: "T1",
          channelId: id,
          messageTs: "1.2",
          channelType: type,
        },
      },
    },
    emptyRunResultEvidence(),
    { announce: true }
  );
  if (expectMention) expect(posts[0]?.text).toContain("<@U123>");
  else expect(posts[0]?.text).not.toContain("<@U123>");
});

it.each([
  {
    case: "duplicate",
    threadMsgs: [
      { ts: "1.3", bot_id: "B123", text: "/runs/run-1?view=details" },
    ],
    expectPost: false,
  },
  { case: "no prior", threadMsgs: [], expectPost: true },
  { case: "check fails", threadMsgs: "throw", expectPost: true },
] as const)(
  "idempotent announcement: $case",
  async ({ threadMsgs, expectPost }) => {
    const posts: PostSlackMessageInput[] = [];
    const threadRun = {
      ...run,
      metadata: {
        ...run.metadata,
        slackRunControls: {
          teamId: "T1",
          channelId: "C1",
          messageTs: "1.2",
          threadTs: "1.1",
        },
      },
    };
    await stripSlackRunControlsForTerminalRun(
      threadRun,
      "success",
      {
        getSlackBotToken: async () => "fixture-token",
        updateSlackMessage: async () => {},
        postSlackMessage: async (_token, msg) => posts.push(msg),
        getThreadMessages: async () => {
          if (threadMsgs === "throw") throw new Error("Slack API unavailable");
          return [...threadMsgs];
        },
        loadRunOutput: async () => "Done.",
        loadEvidence: async () => emptyRunResultEvidence(),
      },
      { announce: true }
    );
    expect(posts).toHaveLength(expectPost ? 1 : 0);
  }
);
