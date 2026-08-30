import assert from "node:assert/strict";
import test, { before } from "node:test";

import type { SlackCommandPayload } from "../../lib/slack/command";

type CommandModule = typeof import("../../lib/slack/command");
let mod: CommandModule;

before(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  process.env.NEXT_PUBLIC_APP_URL ||= "https://app.example.test";
  mod = await import("../../lib/slack/command");
});

const PAYLOAD: SlackCommandPayload = {
  command: "/mogplex",
  text: "help",
  teamId: "T123",
  channelId: "C123",
  slackUserId: "U123",
  responseUrl: "https://hooks.slack.test/response",
};

const INSTALLATION = {
  id: "installation-1",
  installed_by_user_id: "user-1",
  authed_user_slack_id: "U123",
} as never;

const REPO = {
  id: "11111111-1111-4111-8111-111111111111",
  full_name: "acme/widgets",
  installation_id: 42,
  default_branch: "main",
  root_directory: null,
};

function makeDeps(overrides: Record<string, unknown> = {}) {
  const responses: Array<Record<string, unknown>> = [];
  const deps = {
    getInstallation: async () => INSTALLATION,
    getUserMapping: async () => null,
    getChannelLink: async () => null,
    setChannelLink: async () => ({}),
    listRepos: async () => [REPO],
    loadLatestRun: async () => null,
    listRunEvents: async () => null,
    listUsableModels: async () => ["openai/gpt-5.4"],
    resolveDefaultModel: async () => "openai/gpt-5.4",
    getModelPreference: async () => null,
    loadUsage: async () => ({
      plan: "pro",
      status: "active",
      includedCents: 500,
      purchasedCents: 250,
      totalCents: 750,
    }),
    listPullRequests: async () => ({ totalCount: 0, pullRequests: [] }),
    listIssues: async () => ({ totalCount: 0, issues: [] }),
    getBotToken: async () => "xoxb-test",
    openView: async () => ({}),
    handleModelCommand: async () => undefined,
    postResponse: async (_url: string, body: Record<string, unknown>) => {
      responses.push(body);
    },
    ...overrides,
  };
  return { deps, responses };
}

function responseBlocks(responses: Array<Record<string, unknown>>) {
  return responses[0]?.blocks as Array<Record<string, unknown>>;
}

test("bare /mogplex opens the command hub", async () => {
  const { deps, responses } = makeDeps();
  const handler = mod.createSlackCommandHandler(deps as never);

  await handler({ ...PAYLOAD, text: "" });

  assert.match(String(responses[0]?.text), /status, repo, prs, issues, usage/i);
  const blocks = responseBlocks(responses);
  assert.equal(blocks[1]?.type, "actions");
  assert.match(JSON.stringify(blocks), /mogplex_select_command/);
});

test("status shows only the invoking user's latest Slack run and cancel control", async () => {
  const latestCalls: unknown[] = [];
  const { deps, responses } = makeDeps({
    loadLatestRun: async (input: unknown) => {
      latestCalls.push(input);
      return {
        id: "run_abc",
        user_id: "user-1",
        repo_id: REPO.id,
        ai_call_id: "call-1",
        status: "streaming",
        working_branch: "mogplex/fix",
        metadata: { repo: REPO.full_name },
        error: "internal failure at /private/runtime/worker.ts",
      };
    },
    listRunEvents: async () => ({
      events: [{ message: "Running tests", toolName: null }],
    }),
  });
  const handler = mod.createSlackCommandHandler(deps as never);

  await handler({ ...PAYLOAD, text: "status" });

  assert.deepEqual(latestCalls, [
    { userId: "user-1", teamId: "T123", slackUserId: "U123" },
  ]);
  const body = JSON.stringify(responseBlocks(responses));
  assert.match(body, /Running tests/);
  assert.match(body, /mogplex-cancel-run/);
  assert.match(body, /openai\/gpt-5.4/);
  assert.match(body, /Mogplex could not complete this run/);
  assert.doesNotMatch(body, /private\/runtime/);
});

test("repo picker lets the installer replace the channel repository", async () => {
  const saved: unknown[] = [];
  const { deps, responses } = makeDeps({
    setChannelLink: async (input: unknown) => {
      saved.push(input);
      return {};
    },
  });
  const handler = mod.createSlackCommandHandler(deps as never);

  await handler({ ...PAYLOAD, text: `repo ${REPO.id}` });

  assert.deepEqual(saved, [
    {
      installationId: "installation-1",
      channelId: "C123",
      channelName: null,
      repoId: REPO.id,
      createdByUserId: "user-1",
    },
  ]);
  assert.match(String(responses[0]?.text), /set to acme\/widgets/i);
});

test("repo picker prevents a non-installer from changing channel context", async () => {
  let saveCount = 0;
  const { deps, responses } = makeDeps({
    getUserMapping: async () => ({
      mogplex_user_id: "user-2",
      link_status: "explicit",
    }),
    setChannelLink: async () => {
      saveCount += 1;
      return {};
    },
  });
  const handler = mod.createSlackCommandHandler(deps as never);

  await handler({ ...PAYLOAD, text: `repo ${REPO.id}` });

  assert.equal(saveCount, 0);
  assert.match(String(responses[0]?.text), /only the Slack app installer/i);
});

test("prs reports readiness and pins merge actions to the listed head", async () => {
  const { deps, responses } = makeDeps({
    getChannelLink: async () => ({ repo_id: REPO.id }),
    listPullRequests: async () => ({
      totalCount: 1,
      pullRequests: [
        {
          number: 17,
          title: "Fix the widget",
          url: "https://github.com/acme/widgets/pull/17",
          author: "octocat",
          isDraft: false,
          mergeable: "mergeable",
          reviewDecision: "approved",
          checkState: "success",
          unresolvedReviewThreads: 0,
          headSha: "a".repeat(40),
        },
      ],
    }),
  });
  const handler = mod.createSlackCommandHandler(deps as never);

  await handler({ ...PAYLOAD, text: "prs" });

  const blocks = JSON.stringify(responseBlocks(responses));
  assert.match(blocks, /#17 Fix the widget/);
  assert.match(blocks, /mogplex_merge_pr/);
  assert.match(blocks, /aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/);
});

test("issues lists linked-repo issues and opens the create modal", async () => {
  const opened: unknown[] = [];
  const { deps, responses } = makeDeps({
    getChannelLink: async () => ({ repo_id: REPO.id }),
    listIssues: async () => ({
      totalCount: 1,
      issues: [
        {
          number: 9,
          title: "Broken widget",
          url: "https://github.com/acme/widgets/issues/9",
          author: "octocat",
          updatedAt: null,
        },
      ],
    }),
    openView: async (_token: string, input: unknown) => {
      opened.push(input);
      return {};
    },
  });
  const handler = mod.createSlackCommandHandler(deps as never);

  await handler({ ...PAYLOAD, text: "issues" });
  assert.match(JSON.stringify(responseBlocks(responses)), /Broken widget/);

  await handler({
    ...PAYLOAD,
    text: "issues create",
    triggerId: "trigger-1",
  });
  assert.equal(opened.length, 1);
  assert.match(JSON.stringify(opened[0]), /mogplex_issue_create/);
});

test("usage returns user-facing plan and inference credit only", async () => {
  const { deps, responses } = makeDeps();
  const handler = mod.createSlackCommandHandler(deps as never);

  await handler({ ...PAYLOAD, text: "usage" });

  const body = JSON.stringify(responses[0]);
  assert.match(body, /\$7\.50/);
  assert.match(body, /pro/);
  assert.doesNotMatch(body, /accountId|eventSequence|provider/i);
});

test("model remains compatible through the command router", async () => {
  const delegated: SlackCommandPayload[] = [];
  const { deps, responses } = makeDeps({
    handleModelCommand: async (payload: SlackCommandPayload) => {
      delegated.push(payload);
    },
  });
  const handler = mod.createSlackCommandHandler(deps as never);

  await handler({ ...PAYLOAD, text: "model openai/gpt-5.4" });

  assert.equal(responses.length, 0);
  assert.equal(delegated[0]?.text, "model openai/gpt-5.4");
});
