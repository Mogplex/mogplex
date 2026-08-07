import assert from "node:assert/strict";
import test from "node:test";
import {
  coerceGraph,
  createDefaultFlowGraph,
  validateFlowGraph,
} from "../../lib/flows/graph";
import { actionOperator } from "../../lib/flows/operators/action";
import type { FlowGraph, FlowNode } from "../../lib/types";
import type { CompletedNodeRun } from "./helpers/flow-graph-fixtures";

test("action operator keeps command source static and persists structured output", async () => {
  const actionNode: Extract<FlowNode, { type: "action" }> = {
    id: "action-1",
    type: "action",
    position: { x: 200, y: 0 },
    data: {
      label: "Test package",
      operation: "sandbox.run_command",
      command: "pnpm --filter web test",
      workingDirectory: null,
    },
  };
  const graph: FlowGraph = {
    nodes: [
      {
        id: "start",
        type: "start",
        position: { x: 0, y: 0 },
        data: { label: "Start", event: "push" },
      },
      actionNode,
      {
        id: "end",
        type: "end",
        position: { x: 400, y: 0 },
        data: { label: "Done" },
      },
    ],
    edges: [
      { id: "start-action", source: "start", target: actionNode.id },
      { id: "action-end", source: actionNode.id, target: "end" },
    ],
  };
  const completed: CompletedNodeRun[] = [];
  let receivedCommand = "";
  const outputs = new Map<string, { label: string; text: string }>();
  const result = await actionOperator.execute!({
    node: actionNode,
    label: actionNode.data.label,
    graph,
    inboundTokens: [
      {
        fromNodeId: "start",
        label: "Start",
        text: "",
        skipped: false,
      },
    ],
    activeInboundTokens: [
      {
        fromNodeId: "start",
        label: "Start",
        text: "",
        skipped: false,
      },
    ],
    shouldSkip: false,
    outputs,
    flowState: new Map(),
    resolutionState: {
      metadata: { package: "web; touch /tmp/should-not-run" },
    },
    predecessorOutputs: () => [],
    emit: (label, text, options) => [
      {
        targetId: "end",
        token: {
          fromNodeId: actionNode.id,
          label,
          text,
          skipped: options?.skipped ?? false,
          payload: options?.payload,
        },
      },
    ],
    completeNodeRun: async (completion) => {
      completed.push(completion);
      return 1;
    },
    completeSkipped: async () => ({ ok: true, emitted: [] }),
    jobRunId: "job-1",
    flowId: "flow-1",
    flowVersionId: null,
    userId: "user-1",
    installationId: 1,
    repoId: "repo-1",
    waitProvider: {
      sleep: async () => undefined,
      createToken: async () => ({ id: "token" }),
      waitForToken: async () => ({
        ok: false as const,
        reason: "timeout" as const,
        message: "unused",
      }),
    },
    waitStore: {
      createWait: async () => ({ id: "wait" }),
      finalizeWait: async () => undefined,
    },
    actionRunner: async ({ action }) => {
      assert.equal(action.operation, "sandbox.run_command");
      receivedCommand = action.command;
      return {
        summary: "Tests passed",
        output: { exit_code: 0, stdout: "ok" },
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(receivedCommand, "pnpm --filter web test");
  assert.deepEqual(completed[0], {
    status: "success",
    output: {
      operation: "sandbox.run_command",
      exit_code: 0,
      stdout: "ok",
    },
  });
  assert.deepEqual(outputs.get(actionNode.id), {
    label: "Test package",
    text: "Tests passed",
  });
  assert.equal(result.ok && result.emitted[0].token.payload?.exit_code, 0);
});

test("action validation rejects templates in shell command source", () => {
  const startNode: Extract<FlowNode, { type: "start" }> = {
    id: "start",
    type: "start",
    position: { x: 0, y: 0 },
    data: { label: "Start", event: "push" },
  };
  const node: Extract<FlowNode, { type: "action" }> = {
    id: "action-1",
    type: "action",
    position: { x: 200, y: 0 },
    data: {
      label: "Inspect branch",
      operation: "sandbox.run_command",
      command: "git diff {{ metadata.head_ref }}",
      workingDirectory: null,
    },
  };
  const errors = actionOperator.validate!({
    node,
    graph: {
      nodes: [startNode, node],
      edges: [
        { id: "in", source: "start", target: node.id },
        { id: "out", source: node.id, target: "end" },
      ],
    },
    inbound: [{ id: "in", source: "start", target: node.id }],
    outbound: [{ id: "out", source: node.id, target: "end" }],
    startNode,
    options: { requireRunnableConfig: true },
  });

  assert.deepEqual(errors, [
    'Action "Inspect branch" cannot use templates in shell commands.',
  ]);
});

test("coerceGraph preserves safe merge action configuration", () => {
  const graph = coerceGraph({
    nodes: [
      {
        id: "merge",
        type: "action",
        position: { x: 0, y: 0 },
        data: {
          label: "Merge when safe",
          operation: "github.merge_pull_request",
          pullRequestNumber: "{{ metadata.pr_number }}",
          commitTitle: "chore: merge {{ repo.full_name }}",
        },
      },
    ],
    edges: [],
  });

  assert.deepEqual(graph.nodes[0]?.data, {
    label: "Merge when safe",
    operation: "github.merge_pull_request",
    pullRequestNumber: "{{ metadata.pr_number }}",
    commitTitle: "chore: merge {{ repo.full_name }}",
  });
});

test("validateFlowGraph rejects multiple safe-merge request sources", () => {
  const graph = createDefaultFlowGraph({
    event: "pr_opened",
    agentId: "agent-1",
    agentName: "Reviewer",
  });
  const agentNode = graph.nodes.find((node) => node.type === "agent");
  const endNode = graph.nodes.find((node) => node.type === "end");
  assert.ok(agentNode);
  assert.ok(endNode);
  agentNode.data.autoMerge = true;
  graph.nodes.push({
    id: "merge",
    type: "action",
    position: { x: 480, y: 0 },
    data: {
      label: "Merge when safe",
      operation: "github.merge_pull_request",
      pullRequestNumber: null,
      commitTitle: null,
    },
  });
  graph.edges = [
    ...graph.edges.filter((edge) => edge.target !== endNode.id),
    { id: "agent-merge", source: agentNode.id, target: "merge" },
    { id: "merge-end", source: "merge", target: endNode.id },
  ];

  const validation = validateFlowGraph(graph);
  assert.equal(validation.valid, false);
  assert.ok(
    validation.errors.includes(
      "A flow can request at most one pull request merge."
    )
  );
});

test("action validation requires operation-specific fields and a success path", () => {
  const graph = coerceGraph({
    nodes: [
      {
        id: "start",
        type: "start",
        position: { x: 0, y: 0 },
        data: { label: "Start", event: "push" },
      },
      {
        id: "slack",
        type: "action",
        position: { x: 200, y: 0 },
        data: {
          label: "Notify",
          operation: "slack.send_message",
          teamId: "",
          channelId: "",
          message: "",
        },
      },
      {
        id: "agent",
        type: "agent",
        position: { x: 400, y: 0 },
        data: {
          label: "Reviewer",
          agentId: "agent-1",
          role: "review",
          modelOverride: "openai/gpt-5.4",
        },
      },
      {
        id: "end",
        type: "end",
        position: { x: 600, y: 0 },
        data: { label: "Done" },
      },
    ],
    edges: [
      { id: "start-slack", source: "start", target: "slack" },
      { id: "slack-agent", source: "slack", target: "agent" },
      { id: "agent-end", source: "agent", target: "end" },
    ],
  });
  const validation = validateFlowGraph(graph);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.includes("workspace")));
  assert.ok(validation.errors.some((error) => error.includes("channel")));
  assert.ok(validation.errors.some((error) => error.includes("message")));
});

test("Slack trigger-thread actions require a Slack mention trigger", () => {
  const graph = coerceGraph({
    nodes: [
      {
        id: "start",
        type: "start",
        position: { x: 0, y: 0 },
        data: { label: "Start", event: "schedule" },
      },
      {
        id: "slack",
        type: "action",
        position: { x: 200, y: 0 },
        data: {
          label: "Reply",
          operation: "slack.send_message",
          destination: "trigger_thread",
          message: "Done",
        },
      },
      {
        id: "agent",
        type: "agent",
        position: { x: 400, y: 0 },
        data: {
          label: "Reviewer",
          agentId: "agent-1",
          role: "review",
          modelOverride: "openai/gpt-5.4",
        },
      },
      {
        id: "end",
        type: "end",
        position: { x: 600, y: 0 },
        data: { label: "Done" },
      },
    ],
    edges: [
      { id: "start-slack", source: "start", target: "slack" },
      { id: "slack-agent", source: "slack", target: "agent" },
      { id: "agent-end", source: "agent", target: "end" },
    ],
  });

  const validation = validateFlowGraph(graph);

  assert.equal(validation.valid, false);
  assert.ok(
    validation.errors.some((error) =>
      error.includes("from a Slack mention trigger")
    )
  );
});

test("action operator validates GitHub effects and Slack trigger-thread replies", () => {
  const graph = coerceGraph({
    nodes: [
      {
        id: "start",
        type: "start",
        position: { x: 0, y: 0 },
        data: { label: "Start", event: "slack_mention" },
      },
      {
        id: "slack",
        type: "action",
        position: { x: 160, y: 0 },
        data: {
          label: "Reply",
          operation: "slack.send_message",
          destination: "trigger_thread",
          message: "Done",
        },
      },
      {
        id: "labels",
        type: "action",
        position: { x: 320, y: 0 },
        data: {
          label: "Labels",
          operation: "github.update_labels",
          addLabels: [],
          removeLabels: [],
        },
      },
      {
        id: "status",
        type: "action",
        position: { x: 480, y: 0 },
        data: {
          label: "Status",
          operation: "github.set_status",
          state: "not-real",
          context: "",
          targetUrl: "ftp://example.com/result",
        },
      },
      {
        id: "review",
        type: "action",
        position: { x: 640, y: 0 },
        data: {
          label: "Review",
          operation: "github.submit_review",
          event: "APPROVE",
          body: "",
        },
      },
      {
        id: "agent",
        type: "agent",
        position: { x: 800, y: 0 },
        data: {
          label: "Reviewer",
          agentId: "agent-1",
          role: "review",
          modelOverride: "openai/gpt-5.4",
        },
      },
      {
        id: "end",
        type: "end",
        position: { x: 960, y: 0 },
        data: { label: "Done" },
      },
    ],
    edges: [
      { id: "e1", source: "start", target: "slack" },
      { id: "e2", source: "slack", target: "labels" },
      { id: "e3", source: "labels", target: "status" },
      { id: "e4", source: "status", target: "review" },
      { id: "e5", source: "review", target: "agent" },
      { id: "e6", source: "agent", target: "end" },
    ],
  });
  const validation = validateFlowGraph(graph);

  assert.equal(validation.valid, false);
  assert.ok(
    validation.errors.some((error) =>
      error.includes("add or remove at least one label")
    )
  );
  assert.ok(
    validation.errors.some((error) => error.includes("status context"))
  );
  assert.ok(
    validation.errors.some((error) => error.includes("http(s) status URL"))
  );
  assert.ok(validation.errors.some((error) => error.includes("review body")));
  assert.equal(
    validation.errors.some((error) => error.includes("Slack workspace")),
    false
  );

  const status = graph.nodes.find((node) => node.id === "status");
  assert.equal(
    status?.type === "action" &&
      status.data.operation === "github.set_status" &&
      status.data.state,
    "success"
  );
});
