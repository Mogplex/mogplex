import { expect, it } from "vitest";
import type { SlackInstallationRow } from "./installations";
import type { SlackBlockActionsPayload } from "./interactivity";
import {
  handleCheckpointAction,
  handleCheckpointReviseSubmission,
} from "./run-checkpoint-interactions";
import {
  SLACK_CHECKPOINT_APPROVE_ACTION_ID,
  SLACK_CHECKPOINT_FEEDBACK_ACTION_ID,
  SLACK_CHECKPOINT_FEEDBACK_BLOCK_ID,
  SLACK_CHECKPOINT_REVISE_ACTION_ID,
  SLACK_CHECKPOINT_REVISE_CALLBACK_ID,
} from "./run-checkpoint-presentation";

process.env.NEXT_PUBLIC_APP_URL ||= "https://mogplex.com";

const RUN_ID = "00000000-0000-4000-8000-000000000010";
const OWNER = "00000000-0000-4000-8000-000000000011";
const RESPONSE_URL = "https://hooks.slack.test/actions/1";

function actionPayload(
  actionId: string,
  kind: "plan" | "review"
): SlackBlockActionsPayload {
  return {
    type: "block_actions",
    team: { id: "T1" },
    user: { id: "U1" },
    trigger_id: "trigger-1",
    response_url: RESPONSE_URL,
    actions: [{ action_id: actionId, value: `${RUN_ID}|${kind}` }],
    message: {
      text: "plan",
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: "the plan" } },
        { type: "actions", elements: [] },
        { type: "context", elements: [] },
      ],
    },
  };
}

function harness(overrides: Record<string, unknown> = {}) {
  const resumes: Array<Record<string, unknown>> = [];
  const responses: Array<Record<string, unknown>> = [];
  const views: Array<Record<string, unknown>> = [];
  const deps = {
    getInstallation: async () =>
      ({ id: "inst-1", allowed_slack_user_ids: null }) as SlackInstallationRow,
    getUserMapping: async () => ({
      mogplex_user_id: OWNER,
      link_status: "explicit",
    }),
    getBotToken: async () => "xoxb",
    openView: async (
      _token: string,
      input: { view: Record<string, unknown> }
    ) => {
      views.push(input.view);
      return { view: { id: "V1" } };
    },
    postResponse: async (_url: string, body: Record<string, unknown>) => {
      responses.push(body);
    },
    loadRun: async (userId: string) =>
      userId === OWNER
        ? {
            id: RUN_ID,
            user_id: OWNER,
            repo_id: "repo-1",
            ai_call_id: "call-7",
            status: "awaiting_input",
            metadata: { checkpoint_summary: "- Add a toggle" },
          }
        : null,
    queueResume: async (input: Record<string, unknown>) => {
      resumes.push(input);
    },
    ...overrides,
  };
  return {
    resumes,
    responses,
    views,
    deps: deps as unknown as Parameters<typeof handleCheckpointAction>[1],
  };
}

it("should resume an approved plan and replace the buttons with who approved it", async () => {
  const { resumes, responses, deps } = harness();

  const outcome = await handleCheckpointAction(
    actionPayload(SLACK_CHECKPOINT_APPROVE_ACTION_ID, "plan"),
    deps
  );

  expect(outcome).toBe("resumed");
  expect(resumes).toEqual([
    {
      runId: RUN_ID,
      userId: OWNER,
      repoId: "repo-1",
      steer: "The user approved your plan. Implement it now.",
      mode: "review",
      idempotencyKey: `checkpoint-resume:${RUN_ID}:call-7`,
    },
  ]);
  const replaced = JSON.stringify(responses[0]);
  expect(responses[0].replace_original).toBe(true);
  expect(replaced).toContain("the plan");
  expect(replaced).toContain("<@U1> approved the plan");
  expect(replaced).not.toContain('"type":"actions"');
});

it("should ask for feedback in a modal before resuming a revision", async () => {
  const { resumes, views, deps } = harness();

  const outcome = await handleCheckpointAction(
    actionPayload(SLACK_CHECKPOINT_REVISE_ACTION_ID, "plan"),
    deps
  );

  expect(outcome).toBe("revise_opened");
  expect(resumes).toEqual([]);
  expect(views[0].callback_id).toBe(SLACK_CHECKPOINT_REVISE_CALLBACK_ID);
  expect(JSON.parse(String(views[0].private_metadata))).toEqual({
    runId: RUN_ID,
    kind: "plan",
    responseUrl: RESPONSE_URL,
  });
});

it("should keep a revised plan in planning and show the feedback in the thread", async () => {
  const { resumes, responses, deps } = harness();

  const outcome = await handleCheckpointReviseSubmission(
    {
      type: "view_submission",
      team: { id: "T1" },
      user: { id: "U1" },
      view: {
        callback_id: SLACK_CHECKPOINT_REVISE_CALLBACK_ID,
        private_metadata: JSON.stringify({
          runId: RUN_ID,
          kind: "plan",
          responseUrl: RESPONSE_URL,
        }),
        state: {
          values: {
            [SLACK_CHECKPOINT_FEEDBACK_BLOCK_ID]: {
              [SLACK_CHECKPOINT_FEEDBACK_ACTION_ID]: {
                value: "Use CSS variables",
              },
            },
          },
        },
      },
    },
    deps
  );

  expect(outcome).toBe("resumed");
  expect(resumes[0]).toMatchObject({
    steer: "Use CSS variables",
    mode: "plan",
  });
  const replaced = JSON.stringify(responses[0]);
  expect(replaced).toContain("Add a toggle");
  expect(replaced).toContain("asked for changes: “Use CSS variables”");
});

it("should not let someone else approve the run", async () => {
  const { resumes, responses, deps } = harness({
    getUserMapping: async () => ({
      mogplex_user_id: "someone-else",
      link_status: "explicit",
    }),
  });

  const outcome = await handleCheckpointAction(
    actionPayload(SLACK_CHECKPOINT_APPROVE_ACTION_ID, "review"),
    deps
  );

  expect(outcome).toBe("not_owner");
  expect(resumes).toEqual([]);
  expect(responses[0]).toMatchObject({
    response_type: "ephemeral",
    replace_original: false,
  });
});

it("should not resume a run that already moved on", async () => {
  const { resumes, deps } = harness({
    loadRun: async () => ({
      id: RUN_ID,
      user_id: OWNER,
      repo_id: "repo-1",
      ai_call_id: "call-8",
      status: "streaming",
      metadata: {},
    }),
  });

  const outcome = await handleCheckpointAction(
    actionPayload(SLACK_CHECKPOINT_APPROVE_ACTION_ID, "review"),
    deps
  );

  expect(outcome).toBe("not_paused");
  expect(resumes).toEqual([]);
});

it("should respect the workspace's allowed users", async () => {
  const { resumes, deps } = harness({
    getInstallation: async () =>
      ({
        id: "inst-1",
        allowed_slack_user_ids: ["U2"],
      }) as SlackInstallationRow,
  });

  expect(
    await handleCheckpointAction(
      actionPayload(SLACK_CHECKPOINT_APPROVE_ACTION_ID, "review"),
      deps
    )
  ).toBe("not_allowed");
  expect(resumes).toEqual([]);
});
