import assert from "node:assert/strict";
import test, { after } from "node:test";
import type { Tool } from "ai";
import {
  loadSlackEventTask,
  restoreFetch,
  baseInstallation,
  basePayload,
  mappedAttribution,
  agentSuccess,
} from "./helpers/slack-event-task-fixtures";

after(() => {
  restoreFetch();
});

const dmPayload = {
  ...basePayload,
  channelId: "D1",
  channelType: "im" as const,
  eventType: "message" as const,
  text: "Please fix the crash in widgets: TypeError at prompt-node.tsx:1271",
};

const widgetsRepo = {
  repoId: "repo-uuid-1",
  repoFullName: "acme/widgets",
  repoOwner: "acme",
  repoName: "widgets",
  repoBaseBranch: "main",
  teamId: null,
};

type ToolResult =
  | { ok: true; runId: string; runUrl: string; repository: string }
  | { ok: false; error: string };

async function callTool(
  tools: Record<string, Tool> | undefined,
  args: unknown
) {
  const tool = tools?.start_repo_agent_run;
  assert.ok(tool, "start_repo_agent_run tool should be offered to the agent");
  assert.ok(tool.execute);
  return (await tool.execute(args, {
    toolCallId: "call-1",
    messages: [],
  })) as ToolResult;
}

test("DM chat agent can start a full repo-agent run for the resolved repository", async () => {
  const { runSlackEventTask } = await loadSlackEventTask();

  const calls: Array<Record<string, unknown>> = [];
  let toolResult: ToolResult | undefined;

  const result = await runSlackEventTask(dmPayload, {
    getInstallation: async () => baseInstallation,
    getBotToken: async () => "xoxb-test",
    resolveSlackAttribution: async () => mappedAttribution(),
    resolveRepoContext: async () => widgetsRepo,
    loadOrCreateConversation: async () => ({
      id: "conv-dm",
      user_id: "user-mogplex",
      messages: [],
      model: null,
      title: null,
    }),
    persistConversation: async () => undefined,
    runAgent: async (input) => {
      toolResult = await callTool(input.additionalTools, {
        task: "Guard the undefined model read at prompt-node.tsx:1271 and add a regression test.",
      });
      return agentSuccess({ finalText: "Started a run: see below." });
    },
    startRepoAgentRun: async (input) => {
      calls.push({ op: "start_run", input });
      return { runId: "run-dm-1" };
    },
    buildRunUrl: (runId) => `https://example.test/runs/${runId}`,
    postMessage: async (_token, input) => {
      calls.push({ op: "post", input });
      return {
        channel: input.channel,
        ts: `1700000000.00${calls.length}`,
      };
    },
    updateMessage: async (_token, input) => {
      calls.push({ op: "update", input });
      return { channel: input.channel, ts: input.ts };
    },
  });

  assert.equal(result.outcome, "conversational_reply");
  assert.equal(result.runId, "run-dm-1");
  assert.deepEqual(toolResult, {
    ok: true,
    runId: "run-dm-1",
    runUrl: "https://example.test/runs/run-dm-1",
    repository: "acme/widgets",
  });

  const startCall = calls.find((c) => c.op === "start_run") as {
    input: {
      repoId: string;
      prompt: string;
      idempotencyKey: string;
      slackMessage?: { channelId: string; messageTs: string };
      slackContext: { mode: string; channelId: string };
    };
  };
  assert.equal(startCall.input.repoId, "repo-uuid-1");
  assert.match(startCall.input.prompt, /^Guard the undefined model read/);
  assert.match(startCall.input.prompt, /Original Slack request from the user/);
  assert.match(startCall.input.prompt, /TypeError at prompt-node\.tsx:1271/);
  assert.equal(startCall.input.idempotencyKey, "slack:Ev123");
  assert.equal(startCall.input.slackContext.mode, "repo_agent");
  assert.equal(startCall.input.slackContext.channelId, "D1");

  // The run status message is a top-level DM message with a cancel button,
  // and it is the message the completion hook will rewrite.
  const runPost = calls.find(
    (c) =>
      c.op === "post" &&
      (c.input as { text: string }).text.includes("Starting repo agent run")
  ) as { input: { channel: string; thread_ts?: string } };
  assert.ok(runPost);
  assert.equal(runPost.input.channel, "D1");
  assert.equal(runPost.input.thread_ts, undefined);
  assert.equal(startCall.input.slackMessage?.channelId, "D1");
  const startedUpdate = calls.find(
    (c) =>
      c.op === "update" &&
      (c.input as { text: string }).text.includes("Started run")
  ) as { input: { ts: string; blocks?: Array<{ block_id?: string }> } };
  assert.ok(startedUpdate);
  assert.equal(startedUpdate.input.ts, startCall.input.slackMessage?.messageTs);
  assert.ok(
    startedUpdate.input.blocks?.some(
      (block) => block.block_id === "mogplex-run-controls"
    ),
    "run message should carry the cancel button"
  );
});

test("repo-agent tool refuses without a repository and resolves an explicit one", async () => {
  const { runSlackEventTask } = await loadSlackEventTask();

  const resolvedTexts: string[][] = [];
  const startedRepoIds: string[] = [];
  const toolResults: ToolResult[] = [];

  await runSlackEventTask(
    { ...dmPayload, text: "fix the crash" },
    {
      getInstallation: async () => baseInstallation,
      getBotToken: async () => "xoxb-test",
      resolveSlackAttribution: async () => mappedAttribution(),
      resolveRepoContext: async (input) => {
        resolvedTexts.push(input.texts);
        return input.texts[0] === "acme/widgets" ? widgetsRepo : null;
      },
      loadOrCreateConversation: async () => ({
        id: "conv-dm",
        user_id: "user-mogplex",
        messages: [],
        model: null,
        title: null,
      }),
      persistConversation: async () => undefined,
      runAgent: async (input) => {
        toolResults.push(
          await callTool(input.additionalTools, { task: "fix the crash" }),
          await callTool(input.additionalTools, {
            task: "fix the crash",
            repository: "acme/nope",
          }),
          await callTool(input.additionalTools, {
            task: "fix the crash",
            repository: "acme/widgets",
          })
        );
        return agentSuccess({ finalText: "ok" });
      },
      startRepoAgentRun: async (input) => {
        startedRepoIds.push(input.repoId);
        return { runId: "run-explicit" };
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

  assert.equal(toolResults[0]?.ok, false);
  assert.match(
    (toolResults[0] as { error: string }).error,
    /No repository is in context/
  );
  assert.equal(toolResults[1]?.ok, false);
  assert.match(
    (toolResults[1] as { error: string }).error,
    /not one of the user's connected repositories/
  );
  assert.deepEqual(toolResults[2], {
    ok: true,
    runId: "run-explicit",
    runUrl: "https://example.test/runs/run-explicit",
    repository: "acme/widgets",
  });
  assert.deepEqual(startedRepoIds, ["repo-uuid-1"]);
  assert.ok(resolvedTexts.some((texts) => texts[0] === "acme/nope"));
});

test("repo-agent tool starts at most one run per Slack event", async () => {
  const { runSlackEventTask } = await loadSlackEventTask();

  let starts = 0;
  const toolResults: ToolResult[] = [];

  await runSlackEventTask(dmPayload, {
    getInstallation: async () => baseInstallation,
    getBotToken: async () => "xoxb-test",
    resolveSlackAttribution: async () => mappedAttribution(),
    resolveRepoContext: async () => widgetsRepo,
    loadOrCreateConversation: async () => ({
      id: "conv-dm",
      user_id: "user-mogplex",
      messages: [],
      model: null,
      title: null,
    }),
    persistConversation: async () => undefined,
    runAgent: async (input) => {
      toolResults.push(
        await callTool(input.additionalTools, { task: "a" }),
        await callTool(input.additionalTools, { task: "b" })
      );
      return agentSuccess({ finalText: "ok" });
    },
    startRepoAgentRun: async () => {
      starts += 1;
      return { runId: "run-once" };
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
  });

  assert.equal(starts, 1);
  assert.equal(toolResults.length, 2);
  assert.deepEqual(toolResults[0], toolResults[1]);
});

test("repo-agent tool reports policy denials to the agent and posts the notice", async () => {
  const { runSlackEventTask } = await loadSlackEventTask();

  const posted: string[] = [];
  let toolResult: ToolResult | undefined;

  await runSlackEventTask(dmPayload, {
    getInstallation: async () => ({
      ...baseInstallation,
      repo_agent_enabled: false,
    }),
    getBotToken: async () => "xoxb-test",
    resolveSlackAttribution: async () => mappedAttribution(),
    resolveRepoContext: async () => widgetsRepo,
    loadOrCreateConversation: async () => ({
      id: "conv-dm",
      user_id: "user-mogplex",
      messages: [],
      model: null,
      title: null,
    }),
    persistConversation: async () => undefined,
    runAgent: async (input) => {
      toolResult = await callTool(input.additionalTools, { task: "fix" });
      return agentSuccess({ finalText: "ok" });
    },
    startRepoAgentRun: async () => {
      throw new Error("should not start a run when repo agents are disabled");
    },
    buildRunUrl: (runId) => `https://example.test/runs/${runId}`,
    postMessage: async (_token, input) => {
      posted.push(input.text);
      return { channel: input.channel, ts: "1700000000.000999" };
    },
    updateMessage: async (_token, input) => ({
      channel: input.channel,
      ts: input.ts,
    }),
  });

  assert.equal(toolResult?.ok, false);
  assert.match((toolResult as { error: string }).error, /disabled/);
  assert.ok(posted.some((text) => text.includes("disabled")));
});

test("DM system guidance tells the agent to delegate code changes", async () => {
  const { runSlackEventTask } = await loadSlackEventTask();

  let systemSuffix: string | null | undefined;
  await runSlackEventTask(dmPayload, {
    getInstallation: async () => baseInstallation,
    getBotToken: async () => "xoxb-test",
    resolveSlackAttribution: async () => mappedAttribution(),
    resolveRepoContext: async () => widgetsRepo,
    loadOrCreateConversation: async () => ({
      id: "conv-dm",
      user_id: "user-mogplex",
      messages: [],
      model: null,
      title: null,
    }),
    persistConversation: async () => undefined,
    runAgent: async (input) => {
      systemSuffix = input.systemSuffix;
      return agentSuccess({ finalText: "ok" });
    },
    postMessage: async (_token, input) => ({
      channel: input.channel,
      ts: "1700000000.000999",
    }),
    updateMessage: async (_token, input) => ({
      channel: input.channel,
      ts: input.ts,
    }),
  });

  assert.match(systemSuffix ?? "", /call start_repo_agent_run immediately/);
  assert.match(
    systemSuffix ?? "",
    /Do not file a GitHub issue in place of a fix/
  );
});
