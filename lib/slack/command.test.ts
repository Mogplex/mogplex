import { beforeAll, describe, expect, it, vi } from "vitest";
import type { SlackCommandPayload } from "./command";
import type { SlackInstallationRow } from "./installations";

let createSlackCommandHandler: typeof import("./command").createSlackCommandHandler;

beforeAll(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  process.env.NEXT_PUBLIC_APP_URL ||= "https://app.example.test";
  ({ createSlackCommandHandler } = await import("./command"));
});

const payload: SlackCommandPayload = {
  command: "/mogplex",
  text: "",
  teamId: "T1",
  channelId: "C1",
  slackUserId: "U1",
  responseUrl: "https://hooks.slack.test/response",
};

const installation: SlackInstallationRow = {
  id: "installation-1",
  team_id: "T1",
  team_name: "Workspace",
  installed_by_user_id: "user-1",
  bot_user_id: "UBOT",
  vault_bot_token_id: "vault-1",
  scopes: ["commands"],
  authed_user_slack_id: "U1",
  created_at: "2026-08-29T00:00:00Z",
  updated_at: "2026-08-29T00:00:00Z",
};

const repo = {
  id: "11111111-1111-4111-8111-111111111111",
  full_name: "acme/widgets",
  installation_id: 42,
  default_branch: "main",
  root_directory: null,
};

function setup(overrides: Record<string, unknown> = {}) {
  const postResponse = vi.fn(async () => undefined);
  const deps = {
    getInstallation: async () => installation,
    getUserMapping: async () => null,
    getChannelLink: async () => null,
    setChannelLink: async () => ({}) as never,
    listRepos: async () => [repo],
    loadLatestRun: async () => null,
    listRunEvents: async () => null,
    listUsableModels: async () => ["openai/gpt-5.4"],
    resolveDefaultModel: async () => "openai/gpt-5.4",
    getModelPreference: async () => null,
    getHarnessPreference: async () => null,
    saveHarnessPreference: async () => undefined,
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
    postResponse,
    ...overrides,
  };
  return {
    handler: createSlackCommandHandler(deps as never),
    postResponse,
    deps,
  };
}

function firstBody(mock: ReturnType<typeof vi.fn>) {
  return mock.mock.calls[0]?.[1] as Record<string, unknown>;
}

describe("Slack command hub", () => {
  it("shows Mogplex by default through /harness", async () => {
    const { handler, postResponse } = setup();
    await handler({ ...payload, command: "/harness" });
    expect(firstBody(postResponse).text).toContain("Current harness: mogplex");
    expect(firstBody(postResponse).response_type).toBe("ephemeral");
  });

  it.each(["mogplex", "codex", "claude-code"])(
    "saves %s only for the caller in this channel",
    async (harness) => {
      const saveHarnessPreference = vi.fn(async () => undefined);
      const { handler, postResponse } = setup({ saveHarnessPreference });
      await handler({ ...payload, text: `harness ${harness}` });
      expect(saveHarnessPreference).toHaveBeenCalledWith({
        installationId: "installation-1",
        channelId: "C1",
        slackUserId: "U1",
        harness,
      });
      expect(firstBody(postResponse).text).toContain(
        "Existing runs are unchanged"
      );
    }
  );

  it("reads saved harness and rejects unknown names without changing it", async () => {
    const saveHarnessPreference = vi.fn(async () => undefined);
    const { handler, postResponse } = setup({
      getHarnessPreference: async () => "codex",
      saveHarnessPreference,
    });
    await handler({ ...payload, command: "/harness" });
    expect(firstBody(postResponse).text).toContain("Current harness: codex");
    postResponse.mockClear();
    await handler({ ...payload, command: "/harness", text: "unknown" });
    expect(saveHarnessPreference).not.toHaveBeenCalled();
    expect(firstBody(postResponse).text).toContain("Usage:");
  });

  it("does not let an unlinked Slack identity change a harness", async () => {
    const saveHarnessPreference = vi.fn(async () => undefined);
    const { handler, postResponse } = setup({ saveHarnessPreference });
    await handler({
      ...payload,
      command: "/harness",
      text: "codex",
      slackUserId: "UNLINKED",
    });
    expect(saveHarnessPreference).not.toHaveBeenCalled();
    expect(firstBody(postResponse).text).toContain("Link your Slack identity");
  });

  it("opens the interactive hub for bare /mogplex", async () => {
    const { handler, postResponse } = setup();
    await handler(payload);
    expect(firstBody(postResponse)).toMatchObject({
      response_type: "ephemeral",
      text: expect.stringMatching(/status, repo, prs, issues, usage/i),
    });
    expect(JSON.stringify(firstBody(postResponse).blocks)).toContain(
      "mogplex_select_command"
    );
  });

  it("shows scoped status, latest progress, model, and cancel control", async () => {
    const loadLatestRun = vi.fn(async () => ({
      id: "run_1",
      user_id: "user-1",
      repo_id: repo.id,
      ai_call_id: "call-1",
      status: "streaming",
      working_branch: "mogplex/fix",
      metadata: { repo: repo.full_name },
      error: "internal failure at /private/runtime/worker.ts",
    }));
    const { handler, postResponse } = setup({
      loadLatestRun,
      listRunEvents: async () => ({
        events: [{ message: "Running tests", toolName: null }],
      }),
    });

    await handler({ ...payload, text: "status" });

    expect(loadLatestRun).toHaveBeenCalledWith({
      userId: "user-1",
      teamId: "T1",
      slackUserId: "U1",
    });
    const blocks = JSON.stringify(firstBody(postResponse).blocks);
    expect(blocks).toContain("Running tests");
    expect(blocks).toContain("mogplex-cancel-run");
    expect(blocks).toContain("openai/gpt-5.4");
    expect(blocks).toContain("Mogplex could not complete this run");
    expect(blocks).not.toContain("/private/runtime/worker.ts");
  });

  it("lets only the installer replace channel repository context", async () => {
    const setChannelLink = vi.fn(async () => ({}) as never);
    const installer = setup({ setChannelLink });
    await installer.handler({ ...payload, text: `repo ${repo.id}` });
    expect(setChannelLink).toHaveBeenCalledWith({
      installationId: installation.id,
      channelId: payload.channelId,
      channelName: null,
      repoId: repo.id,
      createdByUserId: "user-1",
    });

    const other = setup({
      getUserMapping: async () => ({
        mogplex_user_id: "user-2",
        link_status: "explicit",
      }),
      setChannelLink,
    });
    await other.handler({ ...payload, text: `repo ${repo.id}` });
    expect(firstBody(other.postResponse).text).toMatch(
      /only the Slack app installer/i
    );
    expect(setChannelLink).toHaveBeenCalledTimes(1);
  });

  it("presents linked PR readiness and pins merge to the listed head", async () => {
    const { handler, postResponse } = setup({
      getChannelLink: async () => ({ repo_id: repo.id }),
      listPullRequests: async () => ({
        totalCount: 1,
        pullRequests: [
          {
            number: 17,
            title: "Fix widget",
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
    await handler({ ...payload, text: "prs" });
    const blocks = JSON.stringify(firstBody(postResponse).blocks);
    expect(blocks).toContain("mogplex_merge_pr");
    expect(blocks).toContain("a".repeat(40));
  });

  it("lists issues and opens a create modal from a fresh trigger", async () => {
    const openView = vi.fn(async () => ({}));
    const { handler, postResponse } = setup({
      getChannelLink: async () => ({ repo_id: repo.id }),
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
      openView,
    });
    await handler({ ...payload, text: "issues" });
    expect(JSON.stringify(firstBody(postResponse).blocks)).toContain(
      "Broken widget"
    );
    await handler({
      ...payload,
      text: "issues create",
      triggerId: "trigger-1",
    });
    expect(openView).toHaveBeenCalledWith(
      "xoxb-test",
      expect.objectContaining({ trigger_id: "trigger-1" })
    );
  });

  it("shows user-facing usage and delegates model selection", async () => {
    const handleModelCommand = vi.fn(async () => undefined);
    const usage = setup({ handleModelCommand });
    await usage.handler({ ...payload, text: "usage" });
    expect(JSON.stringify(firstBody(usage.postResponse))).toContain("$7.50");
    expect(JSON.stringify(firstBody(usage.postResponse))).not.toMatch(
      /accountId|eventSequence|provider/i
    );

    await usage.handler({ ...payload, text: "model openai/gpt-5.4" });
    expect(handleModelCommand).toHaveBeenCalledWith(
      expect.objectContaining({ text: "model openai/gpt-5.4" })
    );
  });
});
