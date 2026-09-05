import { expect, it } from "vitest";
import { stripSlackRunControlsForTerminalRun } from "./run-controls-notify";
import type { UpdateSlackMessageInput } from "./client";
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
    "Agent’s closing report (excerpt)\nThe requested fix is complete."
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
    "Last agent update\nThe build failed; verification is unfinished."
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
  },
};
async function render(
  status: "success" | "failed" | "cancelled",
  changes: Partial<typeof run> & { slack_progress?: unknown } = {},
  evidence = emptyRunResultEvidence()
) {
  const updates: UpdateSlackMessageInput[] = [];
  await stripSlackRunControlsForTerminalRun({ ...run, ...changes }, status, {
    getSlackBotToken: async () => "fixture-token",
    updateSlackMessage: async (_token, message) => {
      updates.push(message);
    },
    loadRunOutput: async () =>
      "Changed the header. Tests passed. https://github.com/other/app/pull/99 <!channel>",
    loadEvidence: async () => evidence,
  });
  return updates[0];
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
    text: { type: "plain_text", text: `Artifacts\nPR #42 · open\n${prUrl}` },
  });
  expect(message.blocks).toContainEqual({
    type: "section",
    text: {
      type: "plain_text",
      text: "Your guidance\nSupplied to agent step 2: Keep desktop unchanged",
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
        url: `${process.env.NEXT_PUBLIC_APP_URL}/runs/run-1`,
        action_id: "mogplex-view-run",
      },
      {
        type: "button",
        text: { type: "plain_text", text: "Inspect workspaces" },
        url: `${process.env.NEXT_PUBLIC_APP_URL}/projects/repositories/sandboxes`,
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
      type: "plain_text",
      text: "Last agent update\nInspected the header; edits are unfinished.",
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
        url: `${process.env.NEXT_PUBLIC_APP_URL}/runs/run-1`,
      },
    ],
  });
  expect(JSON.stringify(message.blocks)).not.toContain("mogplex-view-pr");
  expect(JSON.stringify(message.blocks)).not.toContain(
    "mogplex-view-workspaces"
  );
});
