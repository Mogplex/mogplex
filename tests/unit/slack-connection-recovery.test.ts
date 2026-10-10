import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  loadSlackEventTask,
  restoreFetch,
  baseInstallation,
  basePayload,
  mappedAttribution,
  agentSuccess,
} from "./helpers/slack-event-task-fixtures";
import type { RequestSlackConnectionInput } from "@/lib/slack/connection-recovery/request";
import { createSlackConnectionTools } from "@/trigger/slack-event-lib/connection-tools";

after(restoreFetch);

test("an explicit GitHub connector proposal does not inherit another repository's ID", async () => {
  const requests: RequestSlackConnectionInput[] = [];
  const tools = createSlackConnectionTools({
    userId: "user",
    installationId: "installation",
    botToken: "bot",
    payload: basePayload,
    repoId: "old-repo",
    repoFullName: "acme/old",
    deps: {
      requestConnectionRecovery: async (input) => {
        requests.push(input);
        return { ok: true, requestId: "id", message: "Connector proposed" };
      },
    },
  });
  assert.ok(tools.request_connection.execute);
  await tools.request_connection.execute(
    {
      target: { provider: "github", repository: "acme/new", access: "write" },
      resumeText: "Fix acme/new",
    },
    { toolCallId: "call", messages: [], context: {} }
  );
  assert.equal(requests[0].repoId, undefined);
  assert.deepEqual(requests[0].target, {
    provider: "github",
    repository: "acme/new",
    access: "write",
  });
});

test("a queued connection continuation cannot switch to a newly linked account", async () => {
  const { runSlackEventTask } = await loadSlackEventTask();
  const outcome = await runSlackEventTask(
    { ...basePayload, connectionRecoveryRequestId: "saved-request" },
    {
      getInstallation: async () => baseInstallation,
      getBotToken: async () => "bot",
      resolveSlackAttribution: async () =>
        mappedAttribution("different-account"),
      validateConnectionContinuation: async (input) =>
        input.userId === "original-account",
      postMessage: async (_token, input) => {
        assert.match(input.text, /linked account or access changed/);
        return { channel: input.channel, ts: "10.2" };
      },
      runAgent: async () => {
        throw new Error("Must not disclose the saved task to another account");
      },
      startRepoAgentRun: async () => {
        throw new Error("Must not run under another account");
      },
    }
  );
  assert.equal(outcome.outcome, "connection_request_unavailable");
});

for (const recoveryTarget of [
  "github",
  "saved-connector",
  "missing-repository",
] as const) {
  test(`a ${recoveryTarget} continuation retains saved repository ownership after channel relinking`, async () => {
    const { runSlackEventTask } = await loadSlackEventTask();
    const result = runSlackEventTask(
      {
        ...basePayload,
        channelType: "channel",
        eventType: "app_mention",
        connectionRecoveryRequestId: "saved-request",
        ...(recoveryTarget === "github"
          ? { connectionRecoveryRepository: "acme/widgets" }
          : { connectionRecoveryRepoId: repo.repoId }),
        text: "Repository: acme/widgets\nFix the saved task",
      },
      {
        getInstallation: async () => baseInstallation,
        getBotToken: async () => "bot",
        resolveSlackAttribution: async () => mappedAttribution(),
        validateConnectionContinuation: async () => true,
        getChannelLink: async () => ({
          id: "link",
          slack_installation_id: baseInstallation.id,
          channel_id: basePayload.channelId,
          channel_name: "new-project",
          repo_id: "other-repo",
          created_by_user_id: "user-mogplex",
          created_at: "2026-10-10",
        }),
        loadOrCreateConversation: async () => ({
          id: "conv",
          user_id: "user-mogplex",
          messages: [],
          model: null,
          title: null,
        }),
        resolveRepoContext: async ({ texts }) => {
          assert.equal(
            recoveryTarget,
            "github",
            "Saved connector scope must not be inferred again from the thread"
          );
          assert.deepEqual(texts, ["acme/widgets"]);
          return repo;
        },
        loadRepoContextById: async (userId, repoId) => {
          assert.equal(userId, "user-mogplex");
          assert.equal(repoId, repo.repoId);
          return recoveryTarget === "missing-repository" ? null : repo;
        },
        persistConversation: async () => {},
        postMessage: async (_token, input) => ({
          channel: input.channel,
          ts: "10.2",
        }),
        updateMessage: async (_token, input) => ({
          channel: input.channel,
          ts: input.ts,
        }),
        runAgent: async (input) => {
          assert.notEqual(recoveryTarget, "missing-repository");
          assert.equal(input.repoId, repo.repoId);
          return agentSuccess();
        },
        startRepoAgentRun: async () => {
          throw new Error(
            "Must not launch directly against the new channel repo"
          );
        },
      }
    );
    if (recoveryTarget === "missing-repository")
      await assert.rejects(result, /repository is no longer available/);
    else assert.equal((await result).outcome, "conversational_reply");
  });
}
const repo = {
  repoId: "repo-1",
  repoFullName: "acme/widgets",
  repoOwner: "acme",
  repoName: "widgets",
  repoBaseBranch: "main",
  teamId: null,
};

test("a Slack fix request for an unconnected repo offers one connector and saves the correct target instead of launching", async () => {
  const { runSlackEventTask } = await loadSlackEventTask();
  const cards: RequestSlackConnectionInput[] = [];
  const outcome = await runSlackEventTask(
    { ...basePayload, text: "Fix acme/new-project and open a PR" },
    {
      getInstallation: async () => baseInstallation,
      getBotToken: async () => "bot",
      resolveSlackAttribution: async () => mappedAttribution(),
      resolveRepoContext: async ({ texts }) =>
        texts[0] === "acme/new-project" ? null : repo,
      loadOrCreateConversation: async () => ({
        id: "conv",
        user_id: "user-mogplex",
        messages: [],
        model: null,
        title: null,
      }),
      persistConversation: async () => {},
      requestConnectionRecovery: async (input) => {
        cards.push(input);
        return {
          ok: true,
          requestId: "request",
          message: "Open the connector card to authorize.",
        };
      },
      runAgent: async (input) => {
        assert.ok(input.additionalTools?.request_connection);
        assert.ok(input.additionalTools?.find_vercel_projects);
        const execute = input.additionalTools?.start_repo_agent_run.execute;
        assert.ok(execute);
        const args = {
          repository: "acme/new-project",
          task: "Fix the CVE",
          pullRequest: 23,
        };
        const options = { toolCallId: "call", messages: [], context: {} };
        const first = await execute(args, options);
        assert.deepEqual(first, {
          ok: false,
          error: "Open the connector card to authorize.",
        });
        assert.deepEqual(await execute(args, options), first);
        return agentSuccess();
      },
      postMessage: async (_token, input) => ({
        channel: input.channel,
        ts: "10.2",
      }),
      updateMessage: async (_token, input) => ({
        channel: input.channel,
        ts: input.ts,
      }),
      startRepoAgentRun: async () => {
        throw new Error("Must not start a run without access");
      },
    }
  );
  assert.equal(outcome.outcome, "conversational_reply");
  assert.equal(cards.length, 1);
  assert.deepEqual(cards[0].target, {
    provider: "github",
    repository: "acme/new-project",
    access: "write",
  });
  assert.equal(
    cards[0].repoId,
    undefined,
    "must not bind the new target to another contextual repo"
  );
  assert.match(cards[0].resumeText, /Fix the CVE/);
  assert.match(cards[0].resumeText, /Continue pull request #23/);
});

test("a linked channel with a revoked GitHub grant offers recovery instead of starting a doomed run", async () => {
  const { runSlackEventTask } = await loadSlackEventTask();
  const cards: RequestSlackConnectionInput[] = [];
  const outcome = await runSlackEventTask(
    {
      ...basePayload,
      channelType: "channel",
      eventType: "app_mention",
      text: "<@UBOT> fix the crash",
    },
    {
      getInstallation: async () => ({
        ...baseInstallation,
        repo_agent_enabled: true,
      }),
      getBotToken: async () => "bot",
      resolveSlackAttribution: async () => mappedAttribution(),
      getChannelLink: async () => ({
        id: "link",
        slack_installation_id: baseInstallation.id,
        channel_id: basePayload.channelId,
        channel_name: "widgets",
        repo_id: repo.repoId,
        created_by_user_id: "user-mogplex",
        created_at: "2026-10-10",
      }),
      loadRepoContextById: async () => repo,
      checkGithubConnection: async () => false,
      requestConnectionRecovery: async (input) => {
        cards.push(input);
        return {
          ok: true,
          requestId: "request",
          message: "Authorize in Slack",
        };
      },
      startRepoAgentRun: async () => {
        throw new Error("Must not launch without a grant");
      },
    }
  );
  assert.equal(outcome.outcome, "connection_authorization_requested");
  assert.equal(cards.length, 1);
  assert.equal(cards[0].repoId, repo.repoId);
  assert.equal(cards[0].payload.threadTs, basePayload.threadTs);
  assert.match(cards[0].resumeText, /fix the crash/);
});
