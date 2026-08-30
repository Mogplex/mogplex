import { beforeAll, describe, expect, it, vi } from "vitest";
import type { SlackBlockActionsPayload } from "./interactivity";

let createMergeHandler: typeof import("./command-interactions").createSlackPullRequestMergeActionHandler;
let createIssueHandler: typeof import("./command-interactions").createSlackIssueModalSubmissionHandler;

beforeAll(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  const mod = await import("./command-interactions");
  createMergeHandler = mod.createSlackPullRequestMergeActionHandler;
  createIssueHandler = mod.createSlackIssueModalSubmissionHandler;
});

const repo = {
  id: "11111111-1111-4111-8111-111111111111",
  full_name: "acme/widgets",
  installation_id: 42,
  default_branch: "main",
  root_directory: null,
};

const installation = {
  id: "installation-1",
  installed_by_user_id: "user-1",
  authed_user_slack_id: "U1",
} as never;

const payload: SlackBlockActionsPayload = {
  type: "block_actions",
  team: { id: "T1" },
  user: { id: "U1" },
  channel: { id: "C1" },
  response_url: "https://hooks.slack.test/response",
};

function setup(overrides: Record<string, unknown> = {}) {
  const postResponse = vi.fn(async () => undefined);
  return {
    postResponse,
    deps: {
      getInstallation: async () => installation,
      getUserMapping: async () => null,
      getChannelLink: async () => ({ repo_id: repo.id }),
      listRepos: async () => [repo],
      getBotToken: async () => "xoxb-test",
      postEphemeral: async () => ({ message_ts: "1" }),
      postResponse,
      ...overrides,
    },
  };
}

function mergeValue() {
  return JSON.stringify({
    repoId: repo.id,
    number: 17,
    headSha: "a".repeat(40),
  });
}

describe("Slack command mutations", () => {
  it("revalidates the channel repo and exact head before queuing merge", async () => {
    const mergePullRequest = vi.fn(async () => ({
      merged: false,
      queued: true,
      reason: "checks pending",
    }));
    const { deps, postResponse } = setup({ mergePullRequest });
    const handler = createMergeHandler(deps as never);

    await expect(handler(payload, mergeValue())).resolves.toEqual({
      outcome: "pull_request_queued",
      number: 17,
    });
    expect(mergePullRequest).toHaveBeenCalledWith({
      userId: "user-1",
      repo,
      prNumber: 17,
      expectedHeadSha: "a".repeat(40),
    });
    expect(postResponse).toHaveBeenCalledWith(
      payload.response_url,
      expect.objectContaining({ text: expect.stringMatching(/queued/i) })
    );
  });

  it("rejects a merge action after channel repository drift", async () => {
    const mergePullRequest = vi.fn();
    const { deps } = setup({
      getChannelLink: async () => ({ repo_id: "another-repo" }),
      mergePullRequest,
    });
    const handler = createMergeHandler(deps as never);
    await expect(handler(payload, mergeValue())).resolves.toEqual({
      outcome: "ignored",
      reason: "stale_repo",
    });
    expect(mergePullRequest).not.toHaveBeenCalled();
  });

  it("creates a modal issue only in the still-linked owned repo", async () => {
    const createIssue = vi.fn(async () => ({
      issueNumber: 29,
      issueUrl: "https://github.com/acme/widgets/issues/29",
    }));
    const postEphemeral = vi.fn(async () => ({ message_ts: "1" }));
    const { deps } = setup({ createIssue, postEphemeral });
    const handler = createIssueHandler(deps as never);
    const result = await handler({
      ...payload,
      type: "view_submission",
      view: {
        callback_id: "mogplex_issue_create",
        private_metadata: JSON.stringify({
          repoId: repo.id,
          channelId: "C1",
        }),
        state: {
          values: {
            mogplex_issue_title: {
              mogplex_issue_title_value: { value: "Fix the widget" },
            },
            mogplex_issue_body: {
              mogplex_issue_body_value: { value: "Steps" },
            },
          },
        },
      },
    });

    expect(result).toEqual({ outcome: "issue_created", issueNumber: 29 });
    expect(createIssue).toHaveBeenCalledWith({
      userId: "user-1",
      repo,
      title: "Fix the widget",
      body: "Steps",
    });
    expect(postEphemeral).toHaveBeenCalledWith(
      "xoxb-test",
      expect.objectContaining({ channel: "C1", user: "U1" })
    );
  });

  it("rejects tampered issue modal repository metadata", async () => {
    const createIssue = vi.fn();
    const { deps } = setup({ createIssue });
    const handler = createIssueHandler(deps as never);
    const result = await handler({
      ...payload,
      type: "view_submission",
      view: {
        callback_id: "mogplex_issue_create",
        private_metadata: JSON.stringify({
          repoId: "tampered",
          channelId: "C1",
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
    expect(result).toEqual({ outcome: "ignored", reason: "stale_repo" });
    expect(createIssue).not.toHaveBeenCalled();
  });
});
