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

after(restoreFetch);

test("Slack repo-agent explicit target overrides the conversation repository", async () => {
  const { runSlackEventTask } = await loadSlackEventTask();
  let startedRepo: string | undefined;
  const context = {
    repoId: "context-repo",
    repoFullName: "Mogplex/mogplex",
    repoOwner: "Mogplex",
    repoName: "mogplex",
    repoBaseBranch: "main",
    teamId: null,
  };
  const result = await runSlackEventTask(
    {
      ...basePayload,
      channelId: "D1",
      channelType: "im",
      eventType: "message",
      text: "Work on webrenew/gtm-supahost instead of this conversation's repo",
    },
    {
      getInstallation: async () => baseInstallation,
      getBotToken: async () => "xoxb-test",
      resolveSlackAttribution: async () => mappedAttribution(),
      resolveRepoContext: async ({ texts }) =>
        texts[0] === "webrenew/gtm-supahost"
          ? {
              ...context,
              repoId: "actual-target",
              repoFullName: "webrenew/gtm-supahost",
              repoOwner: "webrenew",
              repoName: "gtm-supahost",
            }
          : context,
      loadOrCreateConversation: async () => ({
        id: "conv-dm",
        user_id: "user-mogplex",
        messages: [],
        model: null,
        title: null,
      }),
      persistConversation: async () => undefined,
      postMessage: async (_token, input) => ({
        channel: input.channel,
        ts: "1.1",
      }),
      updateMessage: async (_token, input) => ({
        channel: input.channel,
        ts: input.ts,
      }),
      startRepoAgentRun: async (input) => {
        startedRepo = input.repoId;
        return { runId: "run-override" };
      },
      buildRunUrl: (runId) => `https://example.test/runs/${runId}`,
      runAgent: async (input) => {
        assert.equal(input.repoId, "context-repo");
        const repoTool = input.additionalTools?.start_repo_agent_run;
        assert.ok(repoTool?.execute);
        const toolResult = await repoTool.execute(
          {
            repository: "webrenew/gtm-supahost",
            task: "Fix the header",
          },
          { toolCallId: "test-call", messages: [], context: {} }
        );
        assert.deepEqual(toolResult, {
          ok: true,
          runId: "run-override",
          runUrl: "https://example.test/runs/run-override",
          repository: "webrenew/gtm-supahost",
        });
        return agentSuccess({ finalText: "Started" });
      },
    }
  );
  assert.equal(result.runId, "run-override");
  assert.equal(startedRepo, "actual-target");
});
