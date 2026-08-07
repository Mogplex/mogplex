import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  loadSlackEventTask,
  restoreFetch,
  baseInstallation,
  basePayload,
  mappedAttribution,
  installerFallbackAttribution,
  fixedNow,
  fixedMonthStartDate,
} from "./helpers/slack-event-task-fixtures";

after(() => {
  restoreFetch();
});

test("routes app_mention in a linked channel through the repo-agent branch", async () => {
  const { runSlackEventTask } = await loadSlackEventTask();

  const calls: Array<Record<string, unknown>> = [];

  const result = await runSlackEventTask(
    {
      ...basePayload,
      channelType: "channel" as const,
      eventType: "app_mention" as const,
      text: "<@UBOT> fix the failing test in repo",
    },
    {
      getInstallation: async () => baseInstallation,
      getBotToken: async () => "xoxb-test",
      resolveSlackAttribution: async () => mappedAttribution(),
      getChannelLink: async () => ({
        id: "link-1",
        slack_installation_id: baseInstallation.id,
        channel_id: "C1",
        channel_name: "ops",
        repo_id: "repo-uuid-1",
        created_by_user_id: "installer-user",
        created_at: "2026-05-11T00:00:00Z",
      }),
      loadOrCreateConversation: async () => {
        throw new Error("conversation should not load in repo-agent mode");
      },
      persistConversation: async () => undefined,
      runAgent: async () => {
        throw new Error("agent should not run in repo-agent mode");
      },
      startRepoAgentRun: async (input) => {
        calls.push({ op: "start_run", input });
        return { runId: "run-abc-123" };
      },
      buildRunUrl: (runId) => `https://example.test/runs/${runId}`,
      postMessage: async (_token, input) => {
        calls.push({ op: "post", input });
        return { channel: input.channel, ts: "1700000000.000999" };
      },
      updateMessage: async (_token, input) => {
        calls.push({ op: "update", input });
        return { channel: input.channel, ts: input.ts };
      },
    }
  );

  assert.equal(result.outcome, "repo_agent_run_started");
  assert.equal(result.runId, "run-abc-123");
  assert.equal(result.attachments_attached, 0);
  assert.equal(result.attachments_dropped, 0);

  const startCall = calls.find((c) => c.op === "start_run") as {
    input: {
      mogplexUserId: string;
      repoId: string;
      prompt: string;
      idempotencyKey: string;
      slackMessage?: {
        teamId: string;
        channelId: string;
        messageTs: string;
      };
      slackContext: {
        mode: string;
        teamId: string;
        installationId: string;
        channelId: string;
        slackUserId: string;
        slackEmail: string | null;
        attributionMode: string;
      };
    };
  };
  assert.equal(startCall.input.mogplexUserId, "user-mogplex");
  assert.equal(startCall.input.repoId, "repo-uuid-1");
  assert.equal(startCall.input.prompt, "fix the failing test in repo");
  assert.equal(startCall.input.idempotencyKey, "slack:Ev123");
  assert.deepEqual(startCall.input.slackContext, {
    mode: "repo_agent",
    teamId: "T1",
    installationId: "install-1",
    channelId: "C1",
    slackUserId: "USLACK",
    slackEmail: "user@example.com",
    attributionMode: "mapped_profile",
  });
  assert.deepEqual(startCall.input.slackMessage, {
    teamId: "T1",
    channelId: "C1",
    messageTs: "1700000000.000999",
  });

  const placeholderPost = calls.find((c) => c.op === "post") as {
    input: { channel: string; thread_ts?: string; text: string };
  };
  assert.equal(placeholderPost.input.channel, "C1");
  assert.equal(placeholderPost.input.thread_ts, "1700000000.000100");
  assert.match(placeholderPost.input.text, /Starting repo agent run/);

  const finalUpdate = calls.findLast((c) => c.op === "update") as {
    input: { text: string };
  };
  assert.match(finalUpdate.input.text, /run-abc-123/);
  assert.match(
    finalUpdate.input.text,
    /https:\/\/example\.test\/runs\/run-abc-123/
  );
});

test("passes Slack image-only app_mention events to linked repo agents", async () => {
  const { runSlackEventTask } = await loadSlackEventTask();

  const calls: Array<Record<string, unknown>> = [];

  const result = await runSlackEventTask(
    {
      ...basePayload,
      channelType: "channel" as const,
      eventType: "app_mention" as const,
      text: "<@UBOT>",
      attachments: [
        {
          id: "F1",
          mimetype: "image/png",
          urlPrivateDownload: "https://files.slack.com/files-pri/T-F1/png",
          name: "screenshot.png",
          sizeBytes: 11,
        },
      ],
    },
    {
      getInstallation: async () => baseInstallation,
      getBotToken: async () => "xoxb-test",
      resolveSlackAttribution: async () => mappedAttribution(),
      getChannelLink: async () => ({
        id: "link-1",
        slack_installation_id: baseInstallation.id,
        channel_id: "C1",
        channel_name: "ops",
        repo_id: "repo-uuid-1",
        created_by_user_id: "installer-user",
        created_at: "2026-05-11T00:00:00Z",
      }),
      loadOrCreateConversation: async () => {
        throw new Error("conversation should not load in repo-agent mode");
      },
      persistConversation: async () => undefined,
      fetchAttachment: async () => {
        throw new Error("repo-agent mode should not fetch images in Trigger");
      },
      runAgent: async () => {
        throw new Error("agent should not run in repo-agent mode");
      },
      startRepoAgentRun: async (input) => {
        calls.push({ op: "start_run", input });
        return { runId: "run-image-123" };
      },
      buildRunUrl: (runId) => `https://example.test/runs/${runId}`,
      postMessage: async (_token, input) => {
        calls.push({ op: "post", input });
        return { channel: input.channel, ts: "1700000000.000999" };
      },
      updateMessage: async (_token, input) => {
        calls.push({ op: "update", input });
        return { channel: input.channel, ts: input.ts };
      },
    }
  );

  assert.equal(result.outcome, "repo_agent_run_started");
  assert.equal(result.runId, "run-image-123");
  assert.equal(result.attachments_attached, 1);
  assert.equal(result.attachments_dropped, 0);

  const startCall = calls.find((c) => c.op === "start_run") as {
    input: {
      prompt: string;
      slackAttachments?: Array<{
        id: string;
        mimetype: string;
        urlPrivateDownload: string;
        name?: string;
        sizeBytes?: number;
      }>;
    };
  };
  assert.match(startCall.input.prompt, /attached Slack image/);
  assert.deepEqual(startCall.input.slackAttachments, [
    {
      id: "F1",
      mimetype: "image/png",
      urlPrivateDownload: "https://files.slack.com/files-pri/T-F1/png",
      name: "screenshot.png",
      sizeBytes: 11,
    },
  ]);

  const placeholderPost = calls.find((c) => c.op === "post") as {
    input: { thread_ts?: string };
  };
  assert.equal(placeholderPost.input.thread_ts, "1700000000.000100");
});

test("passes installer-fallback Slack attribution through repo-agent metadata", async () => {
  const { runSlackEventTask } = await loadSlackEventTask();

  const startedContexts: Array<{
    attributionMode?: string;
    slackUserId?: string;
  }> = [];
  const reservations: Array<{
    installationId: string;
    teamId: string;
    eventId: string;
    monthStartDate: string;
    monthlyLimit: number;
  }> = [];

  const result = await runSlackEventTask(
    {
      ...basePayload,
      channelType: "channel" as const,
      eventType: "app_mention" as const,
    },
    {
      getInstallation: async () => ({
        ...baseInstallation,
        monthly_repo_run_limit: 5,
      }),
      getBotToken: async () => "xoxb-test",
      resolveSlackAttribution: async () => installerFallbackAttribution(),
      now: () => fixedNow,
      getChannelLink: async () => ({
        id: "link-1",
        slack_installation_id: baseInstallation.id,
        channel_id: "C1",
        channel_name: "ops",
        repo_id: "repo-uuid-1",
        created_by_user_id: "installer-user",
        created_at: "2026-05-11T00:00:00Z",
      }),
      startRepoAgentRun: async (input) => {
        startedContexts.push(input.slackContext);
        return { runId: "run-fallback-123" };
      },
      reserveSlackRepoAgentMonthlyRun: async (input) => {
        reservations.push(input);
        return true;
      },
      buildRunUrl: (runId) => `https://example.test/runs/${runId}`,
      postMessage: async (_token, input) => ({
        channel: input.channel,
        ts: "1700000000.000999",
      }),
      updateMessage: async (_token, input) => ({
        channel: input.channel,
        ts: input.ts,
      }),
    }
  );

  assert.equal(result.outcome, "repo_agent_run_started");
  assert.equal(result.mogplexUserId, "installer-user");
  assert.equal(result.attachments_attached, 0);
  assert.equal(result.attachments_dropped, 0);
  const startedContext = startedContexts[0];
  assert.ok(startedContext);
  assert.equal(startedContext.attributionMode, "installer_fallback");
  assert.equal(startedContext.slackUserId, "USLACK");
  assert.equal(reservations.length, 1);
  assert.deepEqual(
    {
      installationId: reservations[0]?.installationId,
      teamId: reservations[0]?.teamId,
      eventId: reservations[0]?.eventId,
      monthlyLimit: reservations[0]?.monthlyLimit,
    },
    {
      installationId: "install-1",
      teamId: "T1",
      eventId: "Ev123",
      monthlyLimit: 5,
    }
  );
  assert.equal(reservations[0]?.monthStartDate, fixedMonthStartDate);
});

test("blocks repo-agent runs when the Slack workspace disables them", async () => {
  const { runSlackEventTask } = await loadSlackEventTask();

  const calls: Array<Record<string, unknown>> = [];

  const result = await runSlackEventTask(
    {
      ...basePayload,
      channelType: "channel" as const,
      eventType: "app_mention" as const,
    },
    {
      getInstallation: async () => ({
        ...baseInstallation,
        repo_agent_enabled: false,
      }),
      getBotToken: async () => "xoxb-test",
      resolveSlackAttribution: async () => mappedAttribution(),
      getChannelLink: async () => ({
        id: "link-1",
        slack_installation_id: baseInstallation.id,
        channel_id: "C1",
        channel_name: "ops",
        repo_id: "repo-uuid-1",
        created_by_user_id: "installer-user",
        created_at: "2026-05-11T00:00:00Z",
      }),
      startRepoAgentRun: async () => {
        throw new Error("should not start a disabled workspace run");
      },
      postMessage: async (_token, input) => {
        calls.push({ op: "post", input });
        return { channel: input.channel, ts: "1700000000.000999" };
      },
    }
  );

  assert.equal(result.outcome, "repo_agent_disabled");
  const denial = calls.find((call) => call.op === "post") as {
    input: { text: string };
  };
  assert.match(denial.input.text, /disabled/i);
});

test("treats null repo-agent enablement as default-on for older installation rows", async () => {
  const { runSlackEventTask } = await loadSlackEventTask();

  let startedRun = false;
  const result = await runSlackEventTask(
    {
      ...basePayload,
      channelType: "channel" as const,
      eventType: "app_mention" as const,
    },
    {
      getInstallation: async () => ({
        ...baseInstallation,
        repo_agent_enabled: null,
      }),
      getBotToken: async () => "xoxb-test",
      resolveSlackAttribution: async () => mappedAttribution(),
      getChannelLink: async () => ({
        id: "link-1",
        slack_installation_id: baseInstallation.id,
        channel_id: "C1",
        channel_name: "ops",
        repo_id: "repo-uuid-1",
        created_by_user_id: "installer-user",
        created_at: "2026-05-11T00:00:00Z",
      }),
      startRepoAgentRun: async () => {
        startedRun = true;
        return { runId: "run-1" };
      },
      buildRunUrl: (runId) => `https://example.test/runs/${runId}`,
      postMessage: async (_token, input) => ({
        channel: input.channel,
        ts: "1700000000.000999",
      }),
      updateMessage: async (_token, input) => ({
        channel: input.channel,
        ts: input.ts,
      }),
    }
  );

  assert.equal(result.outcome, "repo_agent_run_started");
  assert.equal(startedRun, true);
});
