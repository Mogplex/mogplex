import assert from "node:assert/strict";
import test, { before } from "node:test";

import type {
  SlackBlockActionsPayload,
  SlackInteractivityDeps,
} from "../../lib/slack/interactivity";

type InteractivityModule = typeof import("../../lib/slack/interactivity");
let mod: InteractivityModule;

before(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  mod = await import("../../lib/slack/interactivity");
});

function payload(
  overrides: Partial<SlackBlockActionsPayload> = {}
): SlackBlockActionsPayload {
  return {
    type: "block_actions",
    team: { id: "T123" },
    user: { id: "U456" },
    channel: { id: "C789" },
    response_url: "https://hooks.slack.test/response",
    ...overrides,
  };
}

test("dispatches command-hub and repository selections with signed context", async () => {
  const dispatched: unknown[] = [];
  const actionPayload = payload({
    trigger_id: "trigger-1",
    actions: [
      {
        action_id: "mogplex_select_repo",
        type: "static_select",
        selected_option: { value: "repo-123" },
      },
    ],
  });

  const result = await mod.handleSlackBlockActions(actionPayload, {
    dispatchCommand: async (input) => {
      dispatched.push(input);
    },
  } as Partial<SlackInteractivityDeps>);

  assert.deepEqual(result, {
    outcome: "command_dispatched",
    command: "repo repo-123",
  });
  assert.deepEqual(dispatched, [
    {
      command: "/mogplex",
      text: "repo repo-123",
      teamId: "T123",
      channelId: "C789",
      slackUserId: "U456",
      responseUrl: "https://hooks.slack.test/response",
      triggerId: "trigger-1",
    },
  ]);
});

test("routes confirmed pull-request merges to the protected handler", async () => {
  const mergeCalls: unknown[] = [];
  const rawValue = JSON.stringify({
    repoId: "repo-1",
    number: 17,
    headSha: "a".repeat(40),
  });
  const actionPayload = payload({
    actions: [
      {
        action_id: "mogplex_merge_pr",
        type: "button",
        value: rawValue,
      },
    ],
  });

  const result = await mod.handleSlackBlockActions(actionPayload, {
    mergePullRequest: async (incomingPayload, incomingValue) => {
      mergeCalls.push({ payload: incomingPayload, rawValue: incomingValue });
      return { outcome: "pull_request_queued", number: 17 };
    },
  } as Partial<SlackInteractivityDeps>);

  assert.deepEqual(result, { outcome: "pull_request_queued", number: 17 });
  assert.deepEqual(mergeCalls, [{ payload: actionPayload, rawValue }]);
});
