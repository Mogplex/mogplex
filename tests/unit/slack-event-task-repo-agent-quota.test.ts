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

test("blocks repo-agent runs for Slack users outside the workspace allowlist", async () => {
  const { runSlackEventTask } = await loadSlackEventTask();

  let countedRuns = false;
  let startedRun = false;
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
        allowed_slack_user_ids: ["UOTHER"],
        monthly_repo_run_limit: 5,
      }),
      getBotToken: async () => "xoxb-test",
      resolveSlackAttribution: async () => installerFallbackAttribution(),
      getChannelLink: async () => ({
        id: "link-1",
        slack_installation_id: baseInstallation.id,
        channel_id: "C1",
        channel_name: "ops",
        repo_id: "repo-uuid-1",
        created_by_user_id: "installer-user",
        created_at: "2026-05-11T00:00:00Z",
      }),
      reserveSlackRepoAgentMonthlyRun: async () => {
        countedRuns = true;
        return true;
      },
      startRepoAgentRun: async () => {
        startedRun = true;
        return { runId: "should-not-start" };
      },
      postMessage: async (_token, input) => {
        calls.push({ op: "post", input });
        return { channel: input.channel, ts: "1700000000.000999" };
      },
    }
  );

  assert.equal(result.outcome, "repo_agent_user_not_allowed");
  assert.equal(countedRuns, false);
  assert.equal(startedRun, false);
  const denial = calls.find((call) => call.op === "post") as {
    input: { text: string };
  };
  assert.match(denial.input.text, /not allowed/i);
});

test("blocks repo-agent runs when the workspace allowlist is explicitly empty", async () => {
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
        allowed_slack_user_ids: [],
      }),
      getBotToken: async () => "xoxb-test",
      resolveSlackAttribution: async () => installerFallbackAttribution(),
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
        return { runId: "should-not-start" };
      },
      postMessage: async (_token, input) => ({
        channel: input.channel,
        ts: "1700000000.000999",
      }),
    }
  );

  assert.equal(result.outcome, "repo_agent_user_not_allowed");
  assert.equal(startedRun, false);
});

test("blocks repo-agent runs when the Slack workspace monthly limit is reached", async () => {
  const { runSlackEventTask } = await loadSlackEventTask();

  let startedRun = false;
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
        monthly_repo_run_limit: 2,
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
      reserveSlackRepoAgentMonthlyRun: async () => false,
      startRepoAgentRun: async () => {
        startedRun = true;
        return { runId: "should-not-start" };
      },
      postMessage: async (_token, input) => {
        calls.push({ op: "post", input });
        return { channel: input.channel, ts: "1700000000.000999" };
      },
    }
  );

  assert.equal(result.outcome, "repo_agent_monthly_limit_reached");
  assert.equal(startedRun, false);
  const denial = calls.find((call) => call.op === "post") as {
    input: { text: string };
  };
  assert.match(denial.input.text, /monthly/i);
});

test("preserves the original repo-agent error when the Slack error update fails", async () => {
  const { runSlackEventTask } = await loadSlackEventTask();

  const releasedReservations: Array<{
    teamId: string;
    eventId: string;
    monthStartDate: string;
  }> = [];

  await assert.rejects(
    () =>
      runSlackEventTask(
        {
          ...basePayload,
          channelType: "channel" as const,
          eventType: "app_mention" as const,
        },
        {
          getInstallation: async () => ({
            ...baseInstallation,
            monthly_repo_run_limit: 2,
          }),
          getBotToken: async () => "xoxb-test",
          resolveSlackAttribution: async () => mappedAttribution(),
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
          loadOrCreateConversation: async () => {
            throw new Error("conversation should not load in repo-agent mode");
          },
          persistConversation: async () => undefined,
          runAgent: async () => {
            throw new Error("agent should not run in repo-agent mode");
          },
          startRepoAgentRun: async () => {
            throw new Error("run queue unavailable");
          },
          reserveSlackRepoAgentMonthlyRun: async () => true,
          releaseSlackRepoAgentMonthlyRun: async (input) => {
            releasedReservations.push(input);
          },
          buildRunUrl: (runId) => `https://example.test/runs/${runId}`,
          postMessage: async (_token, input) => ({
            channel: input.channel,
            ts: "1700000000.000999",
          }),
          updateMessage: async () => {
            throw new Error("slack update failed");
          },
        }
      ),
    /run queue unavailable/
  );

  assert.equal(releasedReservations.length, 1);
  assert.deepEqual(
    {
      teamId: releasedReservations[0]?.teamId,
      eventId: releasedReservations[0]?.eventId,
    },
    { teamId: "T1", eventId: "Ev123" }
  );
  assert.equal(releasedReservations[0]?.monthStartDate, fixedMonthStartDate);
});

test("releases repo-agent quota when the placeholder post fails", async () => {
  const { runSlackEventTask } = await loadSlackEventTask();

  const releasedReservations: Array<{
    teamId: string;
    eventId: string;
    monthStartDate: string;
  }> = [];
  let startedRun = false;

  await assert.rejects(
    () =>
      runSlackEventTask(
        {
          ...basePayload,
          channelType: "channel" as const,
          eventType: "app_mention" as const,
        },
        {
          getInstallation: async () => ({
            ...baseInstallation,
            monthly_repo_run_limit: 2,
          }),
          getBotToken: async () => "xoxb-test",
          resolveSlackAttribution: async () => mappedAttribution(),
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
          startRepoAgentRun: async () => {
            startedRun = true;
            return { runId: "should-not-start" };
          },
          reserveSlackRepoAgentMonthlyRun: async () => true,
          releaseSlackRepoAgentMonthlyRun: async (input) => {
            releasedReservations.push(input);
          },
          buildRunUrl: (runId) => `https://example.test/runs/${runId}`,
          postMessage: async () => {
            throw new Error("slack post failed");
          },
          updateMessage: async () => {
            throw new Error("should not be called");
          },
        }
      ),
    /slack post failed/
  );

  assert.equal(startedRun, false);
  assert.deepEqual(releasedReservations, [
    {
      teamId: "T1",
      eventId: "Ev123",
      monthStartDate: fixedMonthStartDate,
    },
  ]);
});
