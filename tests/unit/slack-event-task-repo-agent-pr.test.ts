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
import { loadSlackPullRequestBranch } from "../../trigger/slack-event-lib/pull-request-branch";
import { defaultStartRepoAgentRun } from "../../trigger/slack-event-lib/run-start";

after(() => {
  restoreFetch();
});

const repo = {
  repoId: "repo-uuid-1",
  repoFullName: "Mogplex/mogplex",
  repoOwner: "Mogplex",
  repoName: "mogplex",
  repoBaseBranch: "main",
  teamId: null,
};

type ToolResult = { ok: boolean; error?: string };

async function runWithTool(
  args: Record<string, unknown>,
  loadPullRequestBranch: typeof loadSlackPullRequestBranch
) {
  const { runSlackEventTask } = await loadSlackEventTask();
  const starts: Array<Record<string, unknown>> = [];
  const lookups: unknown[] = [];
  let toolResult: ToolResult | undefined;
  await runSlackEventTask(
    {
      ...basePayload,
      channelId: "D1",
      channelType: "im" as const,
      eventType: "message" as const,
      text: "Get PR 599 green",
    },
    {
      getInstallation: async () => baseInstallation,
      getBotToken: async () => "xoxb-test",
      resolveSlackAttribution: async () => mappedAttribution(),
      resolveRepoContext: async () => repo,
      loadPullRequestBranch: async (input) => {
        lookups.push(input);
        return loadPullRequestBranch(input);
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
        const tool = input.additionalTools?.start_repo_agent_run;
        assert.ok(tool?.execute);
        toolResult = (await tool.execute(args, {
          context: {},
          toolCallId: "call-1",
          messages: [],
        })) as ToolResult;
        return agentSuccess({ finalText: "ok" });
      },
      startRepoAgentRun: async (input) => {
        starts.push(input as unknown as Record<string, unknown>);
        return { runId: "run-pr-1" };
      },
      buildRunUrl: (runId) => `https://example.test/runs/${runId}`,
      postMessage: async (_token, input) => ({
        channel: input.channel,
        ts: "1.1",
      }),
      updateMessage: async (_token, input) => ({
        channel: input.channel,
        ts: input.ts,
      }),
    }
  );
  return { starts, lookups, toolResult };
}

test("a run for an existing pull request continues its branch instead of opening a new one", async () => {
  const { starts, lookups, toolResult } = await runWithTool(
    { task: "Fix the failing coverage check.", pullRequest: 599 },
    async () => ({
      ok: true,
      headRef: "mogplex/external/9b2a7387-303c566b",
      baseRef: "main",
    })
  );

  assert.equal(toolResult?.ok, true);
  assert.deepEqual(lookups, [
    {
      mogplexUserId: "user-mogplex",
      owner: "Mogplex",
      repo: "mogplex",
      number: 599,
    },
  ]);
  assert.deepEqual(starts[0]?.branch, {
    working: "mogplex/external/9b2a7387-303c566b",
    base: "main",
  });
  assert.match(
    String(starts[0]?.prompt),
    /^You are continuing pull request #599 on its branch mogplex\/external\/9b2a7387-303c566b[\s\S]*Do not open a new pull request\.\n\nFix the failing coverage check\./
  );
});

test("a pull request that can't be continued is reported and starts nothing", async () => {
  const { starts, toolResult } = await runWithTool(
    { task: "Fix it.", pullRequest: 12 },
    async () => ({
      ok: false,
      error: "Pull request Mogplex/mogplex#12 is not open.",
    })
  );

  assert.deepEqual(toolResult, {
    ok: false,
    error: "Pull request Mogplex/mogplex#12 is not open.",
  });
  assert.equal(starts.length, 0);
});

test("new work without a pull request still gets its own branch", async () => {
  const { starts, lookups } = await runWithTool(
    { task: "Add a health endpoint." },
    async () => {
      throw new Error("must not look up a pull request");
    }
  );

  assert.equal(lookups.length, 0);
  assert.equal(starts[0]?.branch, undefined);
});

function prResponse(body: unknown, status = 200) {
  return (async () =>
    new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

const openPr = {
  state: "open",
  head: { ref: "feature/x", repo: { full_name: "Mogplex/mogplex" } },
  base: { ref: "main", repo: { full_name: "Mogplex/mogplex" } },
};
const lookup = {
  mogplexUserId: "u",
  owner: "Mogplex",
  repo: "mogplex",
  number: 7,
};
const findToken = async () => "ghs_test";

test("loadSlackPullRequestBranch returns the head and base of an open same-repo pull request", async () => {
  assert.deepEqual(
    await loadSlackPullRequestBranch(lookup, {
      findToken,
      fetchImpl: prResponse(openPr),
    }),
    { ok: true, headRef: "feature/x", baseRef: "main" }
  );
});

test("loadSlackPullRequestBranch refuses forks, closed and missing pull requests, and missing access", async () => {
  const fork = {
    ...openPr,
    head: { ref: "feature/x", repo: { full_name: "someone/mogplex" } },
  };
  const cases = await Promise.all([
    loadSlackPullRequestBranch(lookup, {
      findToken,
      fetchImpl: prResponse(fork),
    }),
    loadSlackPullRequestBranch(lookup, {
      findToken,
      fetchImpl: prResponse({ ...openPr, state: "closed" }),
    }),
    loadSlackPullRequestBranch(lookup, {
      findToken,
      fetchImpl: prResponse({}, 404),
    }),
    loadSlackPullRequestBranch(lookup, {
      findToken: async () => null,
      fetchImpl: prResponse(openPr),
    }),
  ]);
  assert.deepEqual(
    cases.map((result) => (result.ok ? "ok" : result.error)),
    [
      "Pull request Mogplex/mogplex#7 comes from a fork, so a run can't push to its branch. Start a new run instead.",
      "Pull request Mogplex/mogplex#7 is not open.",
      "Pull request Mogplex/mogplex#7 was not found.",
      "GitHub access to Mogplex/mogplex is unavailable, so pull request #7 can't be continued. Ask the user to reconnect GitHub.",
    ]
  );
});

test("a continued branch reaches the runs API without creating a new branch", async () => {
  const bodies: Array<Record<string, unknown>> = [];
  await defaultStartRepoAgentRun(
    {
      mogplexUserId: "u",
      repoId: "repo-uuid-1",
      prompt: "Fix it",
      idempotencyKey: "slack:Ev1",
      branch: { working: "feature/x", base: "main" },
      slackContext: {
        mode: "repo_agent",
        teamId: "T1",
        installationId: "inst-1",
        channelId: "D1",
        slackUserId: "U1",
        slackEmail: null,
        attributionMode: "mapped_profile",
      },
    } as Parameters<typeof defaultStartRepoAgentRun>[0],
    (async (input: { body: Record<string, unknown> }) => {
      bodies.push(input.body);
      return { run: { runId: "run-1" } };
    }) as unknown as Parameters<typeof defaultStartRepoAgentRun>[1],
    async () => null,
    async () => undefined,
    async () => null,
    async () => null
  );

  assert.equal(bodies[0]?.workingBranch, "feature/x");
  assert.equal(bodies[0]?.baseBranch, "main");
  assert.equal(bodies[0]?.createBranch, false);
});
