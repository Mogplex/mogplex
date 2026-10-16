import { expect, it } from "vitest";
import { SLACK_RUN_DETAILS_ACTION_ID } from "./command-actions";
import type { SlackBlockActionsPayload } from "./interactivity";
import { handleRunDetailsAction } from "./run-details-interactions";
import { emptyRunResultEvidence } from "./run-result-evidence";

process.env.NEXT_PUBLIC_APP_URL ||= "https://mogplex.com";

const RUN_ID = "00000000-0000-4000-8000-000000000020";

const payload: SlackBlockActionsPayload = {
  type: "block_actions",
  team: { id: "T1" },
  user: { id: "U-teammate" },
  channel: { id: "C1" },
  trigger_id: "trigger-1",
  actions: [{ action_id: SLACK_RUN_DETAILS_ACTION_ID, value: RUN_ID }],
};

function harness(run: Record<string, unknown> | null) {
  const views: unknown[] = [];
  const deps = {
    getBotToken: async () => "xoxb",
    openView: async (_token: string, input: { view: unknown }) => {
      views.push(input.view);
      return { view: { id: "V1" } };
    },
    updateView: async (_token: string, input: { view: unknown }) => {
      views.push(input.view);
      return {};
    },
    loadRun: async () => run,
    loadOutput: async () => "Fixed the header.",
    loadEvidence: async () => ({
      ...emptyRunResultEvidence(),
      workspace: {
        status: "paused",
        persistent: true,
        snapshotRecorded: false,
      },
    }),
    loadGuidance: async () => [],
  };
  return {
    views,
    deps: deps as unknown as Parameters<typeof handleRunDetailsAction>[1],
  };
}

const finishedRun = {
  id: RUN_ID,
  user_id: "owner",
  status: "success",
  prompt: "Fix the header",
  working_branch: "fix/header",
  metadata: {
    slackRunControls: { teamId: "T1", channelId: "C1", messageTs: "1.2" },
  },
};

it("should show the full result to anyone in the card's channel", async () => {
  const { views, deps } = harness(finishedRun);

  expect(await handleRunDetailsAction(payload, deps)).toBe("shown");

  expect(JSON.stringify(views[0])).toContain("Loading the run’s details");
  const shown = JSON.stringify(views.at(-1));
  expect(shown).toContain("Fixed the header.");
  expect(shown).toContain("contents have not been checked");
  expect(shown).toContain("No completed test or build result was recorded");
});

it("should not show a run whose card lives in another channel", async () => {
  const { views, deps } = harness({
    ...finishedRun,
    metadata: {
      slackRunControls: { teamId: "T1", channelId: "C-other", messageTs: "1" },
    },
  });

  expect(await handleRunDetailsAction(payload, deps)).toBe("not_in_channel");
  expect(JSON.stringify(views.at(-1))).not.toContain("Fixed the header.");
});

it("should point a still-running run back to its card", async () => {
  const { deps } = harness({ ...finishedRun, status: "streaming" });

  expect(await handleRunDetailsAction(payload, deps)).toBe("not_finished");
});
