import assert from "node:assert/strict";
import test from "node:test";
import {
  createFlowTriggerDispatcher,
  matchesSlackMentionTrigger,
  type PublishedFlowTriggerRow,
  type TriggerRepoRow,
} from "../../lib/flows/trigger-dispatch";
import type { FlowGraph } from "../../lib/types";

function graph(event: "webhook" | "schedule"): FlowGraph {
  return {
    nodes: [
      {
        id: "start",
        type: "start",
        position: { x: 0, y: 0 },
        data: {
          label: "Start",
          event,
          filter: { scope: "all", repos: ["acme/web"] },
          ...(event === "schedule"
            ? { scheduleCron: "0 9 * * *", scheduleTimezone: "UTC" }
            : {}),
        },
      },
      {
        id: "agent",
        type: "agent",
        position: { x: 200, y: 0 },
        data: { label: "Review", agentId: "agent-1", role: "review" },
      },
      {
        id: "end",
        type: "end",
        position: { x: 400, y: 0 },
        data: { label: "Done" },
      },
    ],
    edges: [
      { id: "e1", source: "start", target: "agent" },
      { id: "e2", source: "agent", target: "end" },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

function flow(event: "webhook" | "schedule"): PublishedFlowTriggerRow {
  return {
    id: "flow-1",
    user_id: "user-1",
    installation_id: 123,
    status: "active",
    published_version_id: "version-1",
    published_version: { id: "version-1", graph: graph(event) },
  };
}

const repo: TriggerRepoRow = {
  id: "repo-1",
  user_id: "user-1",
  full_name: "acme/web",
  github_installation_id: 123,
  product_team_id: "team-1",
};

test("external trigger dispatch preserves immutable flow and nested payload context", async () => {
  const enqueues: unknown[] = [];
  const starts: unknown[] = [];
  const dispatch = createFlowTriggerDispatcher({
    loadFlow: async () => flow("webhook"),
    resolveRepo: async () => repo,
    enqueue: async (input) => {
      enqueues.push(input);
      return { outcome: "queued" as const, jobRunId: "run-1", reason: null };
    },
    start: async (jobRunId, source) => {
      starts.push({ jobRunId, source });
      return { started: true, status: "running" };
    },
  });

  const result = await dispatch({
    flowId: "flow-1",
    event: "webhook",
    idempotencyKey: "delivery-1",
    payload: { release: "1.2.3" },
  });

  assert.deepEqual(result, {
    matched: true,
    outcome: "queued",
    jobRunId: "run-1",
    started: true,
    reason: null,
  });
  assert.deepEqual(starts, [{ jobRunId: "run-1", source: "webhook" }]);
  assert.deepEqual(enqueues, [
    {
      userId: "user-1",
      flowId: "flow-1",
      flowVersionId: "version-1",
      repoId: "repo-1",
      installationId: 123,
      sourceKind: "flow",
      sourceType: "webhook",
      idempotencyKey: "delivery-1",
      metadata: {
        repo_id: "repo-1",
        repo_full_name: "acme/web",
        installation_id: 123,
        team_id: "team-1",
        source_type: "webhook",
        flow_id: "flow-1",
        flow_version_id: "version-1",
        webhook: { release: "1.2.3" },
      },
      duplicateSensitive: true,
    },
  ]);
});

test("external trigger dispatch fails closed for event and owner mismatches", async () => {
  let enqueued = false;
  const dispatch = createFlowTriggerDispatcher({
    loadFlow: async () => flow("schedule"),
    resolveRepo: async () => repo,
    enqueue: async () => {
      enqueued = true;
      return { outcome: "queued" as const, jobRunId: "run-1", reason: null };
    },
  });

  assert.equal(
    (
      await dispatch({
        flowId: "flow-1",
        event: "webhook",
        idempotencyKey: "delivery-1",
      })
    ).reason,
    "TRIGGER_MISMATCH"
  );
  assert.equal(
    (
      await dispatch({
        flowId: "flow-1",
        event: "schedule",
        idempotencyKey: "schedule-1",
        expectedUserId: "other-user",
      })
    ).reason,
    "FLOW_NOT_OWNED"
  );
  assert.equal(enqueued, false);
});

test("scheduled occurrences retain idempotency without active-run suppression", async () => {
  const enqueues: Array<{ duplicateSensitive?: boolean }> = [];
  const dispatch = createFlowTriggerDispatcher({
    loadFlow: async () => flow("schedule"),
    resolveRepo: async () => repo,
    enqueue: async (input) => {
      enqueues.push(input);
      return { outcome: "queued" as const, jobRunId: "run-1", reason: null };
    },
    start: async () => ({ started: true, status: "running" }),
  });

  await dispatch({
    flowId: "flow-1",
    event: "schedule",
    idempotencyKey: "schedule:flow-1:2026-07-23T20:00:00.000Z",
  });

  assert.equal(enqueues.length, 1);
  assert.equal(enqueues[0]?.duplicateSensitive, false);
});

test("Slack mention matching is scoped to the configured workspace and channel", () => {
  const slackGraph = graph("webhook");
  const start = slackGraph.nodes.find((node) => node.type === "start");
  assert.ok(start);
  start.data = {
    label: "Slack mention",
    event: "slack_mention",
    slackTeamId: "T123",
    slackChannelId: "C456",
    filter: { scope: "all", repos: ["acme/web"] },
  };

  assert.equal(
    matchesSlackMentionTrigger(slackGraph, {
      teamId: "T123",
      channelId: "C456",
    }),
    true
  );
  assert.equal(
    matchesSlackMentionTrigger(slackGraph, {
      teamId: "T123",
      channelId: "C999",
    }),
    false
  );
});
