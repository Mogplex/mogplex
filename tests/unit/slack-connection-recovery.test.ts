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

after(restoreFetch);
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
