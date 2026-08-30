import assert from "node:assert/strict";
import test, { before } from "node:test";

import type { SlackBlockActionsPayload } from "../../lib/slack/interactivity";

type InteractionModule = typeof import("../../lib/slack/command-interactions");
let mod: InteractionModule;

before(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  mod = await import("../../lib/slack/command-interactions");
});

const REPO = {
  id: "11111111-1111-4111-8111-111111111111",
  full_name: "acme/widgets",
  installation_id: 42,
  default_branch: "main",
  root_directory: null,
};

const INSTALLATION = {
  id: "installation-1",
  installed_by_user_id: "user-1",
  authed_user_slack_id: "U123",
} as never;

function payload(): SlackBlockActionsPayload {
  return {
    type: "block_actions",
    team: { id: "T123" },
    user: { id: "U123" },
    channel: { id: "C123" },
    response_url: "https://hooks.slack.test/response",
  };
}

function mergeValue() {
  return JSON.stringify({
    repoId: REPO.id,
    number: 17,
    headSha: "a".repeat(40),
  });
}

function baseDeps(overrides: Record<string, unknown> = {}) {
  const responses: Array<Record<string, unknown>> = [];
  return {
    responses,
    deps: {
      getInstallation: async () => INSTALLATION,
      getUserMapping: async () => null,
      getChannelLink: async () => ({ repo_id: REPO.id }),
      listRepos: async () => [REPO],
      getBotToken: async () => "xoxb-test",
      postEphemeral: async () => ({}),
      postResponse: async (_url: string, body: Record<string, unknown>) => {
        responses.push(body);
      },
      ...overrides,
    },
  };
}

test("merge confirmation revalidates channel repo and exact PR head", async () => {
  const mergeCalls: unknown[] = [];
  const { deps, responses } = baseDeps({
    mergePullRequest: async (input: unknown) => {
      mergeCalls.push(input);
      return { merged: false, queued: true, reason: "checks pending" };
    },
  });
  const handler = mod.createSlackPullRequestMergeActionHandler(deps as never);

  const result = await handler(payload(), mergeValue());

  assert.deepEqual(mergeCalls, [
    {
      userId: "user-1",
      repo: REPO,
      prNumber: 17,
      expectedHeadSha: "a".repeat(40),
    },
  ]);
  assert.deepEqual(result, { outcome: "pull_request_queued", number: 17 });
  assert.match(String(responses[0]?.text), /queued to merge/i);
});

test("merge action rejects a stale channel repository", async () => {
  let mergeCount = 0;
  const { deps, responses } = baseDeps({
    getChannelLink: async () => ({ repo_id: "another-repo" }),
    mergePullRequest: async () => {
      mergeCount += 1;
      return { merged: true };
    },
  });
  const handler = mod.createSlackPullRequestMergeActionHandler(deps as never);

  const result = await handler(payload(), mergeValue());

  assert.deepEqual(result, { outcome: "ignored", reason: "stale_repo" });
  assert.equal(mergeCount, 0);
  assert.match(String(responses[0]?.text), /repository changed/i);
});

test("issue modal submission creates only in the still-linked owned repo", async () => {
  const created: unknown[] = [];
  const posted: unknown[] = [];
  const { deps } = baseDeps({
    createIssue: async (input: unknown) => {
      created.push(input);
      return {
        issueNumber: 29,
        issueUrl: "https://github.com/acme/widgets/issues/29",
      };
    },
    postEphemeral: async (_token: string, input: unknown) => {
      posted.push(input);
      return {};
    },
  });
  const handler = mod.createSlackIssueModalSubmissionHandler(deps as never);

  const result = await handler({
    ...payload(),
    type: "view_submission",
    view: {
      callback_id: "mogplex_issue_create",
      private_metadata: JSON.stringify({
        repoId: REPO.id,
        channelId: "C123",
      }),
      state: {
        values: {
          mogplex_issue_title: {
            mogplex_issue_title_value: { value: "Fix the widget" },
          },
          mogplex_issue_body: {
            mogplex_issue_body_value: { value: "Steps to reproduce" },
          },
        },
      },
    },
  });

  assert.deepEqual(result, { outcome: "issue_created", issueNumber: 29 });
  assert.deepEqual(created, [
    {
      userId: "user-1",
      repo: REPO,
      title: "Fix the widget",
      body: "Steps to reproduce",
    },
  ]);
  assert.match(JSON.stringify(posted[0]), /issues\/29/);
});

test("issue modal rejects tampered repo metadata before creating", async () => {
  let createCount = 0;
  const { deps } = baseDeps({
    createIssue: async () => {
      createCount += 1;
      return { issueNumber: 1, issueUrl: null };
    },
  });
  const handler = mod.createSlackIssueModalSubmissionHandler(deps as never);

  const result = await handler({
    ...payload(),
    type: "view_submission",
    view: {
      callback_id: "mogplex_issue_create",
      private_metadata: JSON.stringify({
        repoId: "tampered-repo",
        channelId: "C123",
      }),
      state: {
        values: {
          mogplex_issue_title: {
            mogplex_issue_title_value: { value: "Do not create" },
          },
        },
      },
    },
  });

  assert.deepEqual(result, { outcome: "ignored", reason: "stale_repo" });
  assert.equal(createCount, 0);
});
