import assert from "node:assert/strict";
import test from "node:test";
import { createFlowAssistantTools } from "../../lib/flows/assistant-tools";
import type { FlowGraph, FlowNode } from "../../lib/types";

const emptyGraph: FlowGraph = {
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
};

const allowedAgents = [
  { id: "agent-1", name: "Reviewer", slug: "reviewer" },
  { id: "agent-2", name: "Editor", slug: "editor" },
];

/**
 * Helper to invoke a tool's execute function.
 * The AI SDK tool object has an execute property that is a function.
 */
async function invokeTool<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tool: any,
  args: Record<string, unknown>
): Promise<T> {
  return tool.execute(args, { toolCallId: "test", messages: [] });
}

test("addAgentNode with unknown agentId returns error and does not mutate graph", async () => {
  const { tools, getResult } = createFlowAssistantTools({
    initialGraph: emptyGraph,
    allowedAgents,
  });

  const result = await invokeTool<{ error?: string; id?: string }>(
    tools.addAgentNode,
    { label: "Test Agent", agentId: "unknown-agent" }
  );

  assert.ok(result.error);
  assert.ok(result.error.includes("unknown-agent"));
  assert.equal(result.id, undefined);

  const graph = getResult().graph;
  assert.equal(graph.nodes.length, 0);
});

test("chat tools require getGraphState hydration before mutating", async () => {
  const { tools, getResult } = createFlowAssistantTools({
    initialGraph: null,
    allowedAgents,
    includeGraphStateTool: true,
  });

  assert.ok("getGraphState" in tools);
  const result = await invokeTool<{ error?: string; id?: string }>(
    tools.addAgentNode,
    { label: "Test Agent", agentId: "agent-1" }
  );

  assert.equal(result.id, undefined);
  assert.match(result.error ?? "", /getGraphState/);
  assert.equal(getResult().hydrated, false);
});

test("addAgentNode with allowed agentId adds node and returns id", async () => {
  const { tools, getResult } = createFlowAssistantTools({
    initialGraph: emptyGraph,
    allowedAgents,
  });

  const result = await invokeTool<{ id: string }>(tools.addAgentNode, {
    label: "Test Agent",
    agentId: "agent-1",
    role: "review",
  });

  assert.ok(result.id);
  assert.ok(result.id.startsWith("agent-"));

  const graph = getResult().graph;
  assert.equal(graph.nodes.length, 1);
  assert.equal(graph.nodes[0].type, "agent");
  assert.equal(graph.nodes[0].data.agentId, "agent-1");
});

function agentNodeModel(graph: FlowGraph) {
  const node = graph.nodes.find((n) => n.type === "agent");
  return node?.type === "agent" ? node.data.modelOverride : undefined;
}

// The node is the only source of a step's model, and publish only checks the
// field is non-empty — so an id the assistant invented would publish cleanly
// and fail on first run. Constrain it here the way agentId is constrained.
test("addAgentNode rejects a model id outside the scope's catalog", async () => {
  const { tools, getResult } = createFlowAssistantTools({
    initialGraph: emptyGraph,
    allowedAgents,
    allowedModelIds: ["anthropic/claude-opus-5", "openai/gpt-5"],
  });

  const result = await invokeTool<{ error?: string; id?: string }>(
    tools.addAgentNode,
    { label: "Test Agent", agentId: "agent-1", model: "claude-3-opus" }
  );

  assert.ok(result.error);
  assert.match(result.error, /claude-3-opus/);
  // The error must name the valid ids so the assistant can retry against them.
  assert.match(result.error, /anthropic\/claude-opus-5/);
  assert.equal(result.id, undefined);
  assert.equal(getResult().graph.nodes.length, 0);
});

test("addAgentNode keeps a model id the scope can invoke", async () => {
  const { tools, getResult } = createFlowAssistantTools({
    initialGraph: emptyGraph,
    allowedAgents,
    allowedModelIds: ["anthropic/claude-opus-5", "openai/gpt-5"],
  });

  const result = await invokeTool<{ id: string }>(tools.addAgentNode, {
    label: "Test Agent",
    agentId: "agent-1",
    model: "openai/gpt-5",
  });

  assert.ok(result.id);
  assert.equal(agentNodeModel(getResult().graph), "openai/gpt-5");
});

test("addAgentNode without a model falls back to one the scope can invoke", async () => {
  const { tools, getResult } = createFlowAssistantTools({
    initialGraph: emptyGraph,
    allowedAgents,
    // Deliberately excludes DEFAULT_NEW_AGENT_MODEL_ID: a workspace whose only
    // usable credential is OpenAI must not be handed the build-time constant.
    allowedModelIds: ["openai/gpt-5"],
  });

  await invokeTool<{ id: string }>(tools.addAgentNode, {
    label: "Test Agent",
    agentId: "agent-1",
  });

  assert.equal(agentNodeModel(getResult().graph), "openai/gpt-5");
});

test("addAgentNode leaves the model unconstrained when no catalog is supplied", async () => {
  const { tools, getResult } = createFlowAssistantTools({
    initialGraph: emptyGraph,
    allowedAgents,
  });

  const result = await invokeTool<{ id: string; error?: string }>(
    tools.addAgentNode,
    { label: "Test Agent", agentId: "agent-1", model: "some/model" }
  );

  assert.equal(result.error, undefined);
  assert.equal(agentNodeModel(getResult().graph), "some/model");
});

test("action tools add sandbox, Slack, and GitHub operations with typed data", async () => {
  const { tools, getResult } = createFlowAssistantTools({
    initialGraph: emptyGraph,
    allowedAgents,
  });

  const command = await invokeTool<{ id: string }>(tools.addRunCommandNode, {
    label: "Run tests",
    command: "pnpm test",
    workingDirectory: "apps/web",
  });
  const slack = await invokeTool<{ id: string }>(tools.addSlackMessageNode, {
    label: "Notify",
    destination: "trigger_thread",
    message: "Tests passed for {{ repo.full_name }}",
  });
  const comment = await invokeTool<{ id: string }>(tools.addGithubCommentNode, {
    label: "Comment",
    body: "Completed: {{ outputs_by_label.Review }}",
  });
  const issue = await invokeTool<{ id: string }>(tools.addGithubIssueNode, {
    label: "Follow up",
    title: "Follow up for {{ repo.full_name }}",
    body: "Details",
    labels: ["automation"],
  });
  const labels = await invokeTool<{ id: string }>(tools.addGithubLabelsNode, {
    label: "Mark ready",
    addLabels: ["ready"],
    removeLabels: ["needs-review"],
  });
  const status = await invokeTool<{ id: string }>(tools.addGithubStatusNode, {
    label: "Publish status",
    state: "success",
    context: "mogplex/release",
  });
  const review = await invokeTool<{ id: string }>(tools.addGithubReviewNode, {
    label: "Approve",
    event: "APPROVE",
    body: "Automated checks passed.",
  });
  const merge = await invokeTool<{ id: string }>(tools.addGithubMergeNode, {
    label: "Merge when safe",
    commitTitle: "chore: merge {{ repo.full_name }}",
  });

  const graph = getResult().graph;
  const commandNode = graph.nodes.find((node) => node.id === command.id);
  const slackNode = graph.nodes.find((node) => node.id === slack.id);
  assert.ok(commandNode?.type === "action");
  assert.deepEqual(commandNode.data, {
    label: "Run tests",
    operation: "sandbox.run_command",
    command: "pnpm test",
    workingDirectory: "apps/web",
  });
  assert.ok(slackNode?.type === "action");
  assert.deepEqual(slackNode.data, {
    label: "Notify",
    operation: "slack.send_message",
    destination: "trigger_thread",
    teamId: "",
    channelId: "",
    channelName: null,
    message: "Tests passed for {{ repo.full_name }}",
    unfurlLinks: false,
  });
  assert.deepEqual(graph.nodes.find((node) => node.id === comment.id)?.data, {
    label: "Comment",
    operation: "github.post_comment",
    targetNumber: null,
    body: "Completed: {{ outputs_by_label.Review }}",
  });
  const githubNodes = [issue, labels, status, review, merge].map(({ id }) =>
    graph.nodes.find((node) => node.id === id)
  );
  assert.ok(githubNodes.every((node) => node?.type === "action"));
  assert.deepEqual(
    githubNodes.map((node) =>
      node?.type === "action" ? node.data.operation : null
    ),
    [
      "github.create_issue",
      "github.update_labels",
      "github.set_status",
      "github.submit_review",
      "github.merge_pull_request",
    ]
  );
  assert.deepEqual(graph.nodes.find((node) => node.id === merge.id)?.data, {
    label: "Merge when safe",
    operation: "github.merge_pull_request",
    pullRequestNumber: null,
    commitTitle: "chore: merge {{ repo.full_name }}",
  });
});

test("addAwaitEventNode builds comment, CI, Vercel, and manual approval waits", async () => {
  const { tools, getResult } = createFlowAssistantTools({
    initialGraph: emptyGraph,
    allowedAgents,
  });

  await invokeTool(tools.addAwaitEventNode, {
    label: "Wait for approval comment",
    kind: "github_comment_added",
    bodyContains: "approved",
    authorLogin: "@alice",
  });
  await invokeTool(tools.addAwaitEventNode, {
    label: "Wait for CI",
    kind: "ci_workflow_completed",
    workflowName: "CI / test",
    conclusion: "success",
  });
  await invokeTool(tools.addAwaitEventNode, {
    label: "Wait for preview",
    kind: "vercel_preview_ready",
    environment: "Preview",
  });
  await invokeTool(tools.addAwaitEventNode, {
    label: "Production gate",
    kind: "manual_approval",
    prompt: "Approve production deployment",
    timeoutValue: 24,
    timeoutUnit: "hours",
  });

  const awaitNodes = getResult().graph.nodes.filter(
    (node): node is Extract<FlowNode, { type: "await_event" }> =>
      node.type === "await_event"
  );
  assert.equal(awaitNodes.length, 4);
  assert.deepEqual(awaitNodes[0]?.data.config, {
    kind: "github_comment_added",
    bodyContains: "approved",
    authorLogin: "alice",
    prOnly: true,
    matchTriggerIssue: true,
  });
  assert.deepEqual(awaitNodes[1]?.data.config, {
    kind: "ci_workflow_completed",
    workflowName: "CI / test",
    conclusion: "success",
    matchTriggerSha: true,
  });
  assert.deepEqual(awaitNodes[2]?.data.config, {
    kind: "vercel_preview_ready",
    environment: "Preview",
    matchTriggerSha: true,
  });
  assert.deepEqual(awaitNodes[3]?.data, {
    label: "Production gate",
    config: {
      kind: "manual_approval",
      prompt: "Approve production deployment",
    },
    timeout: { value: 24, unit: "hours" },
  });
});

test("addTransformNode builds deterministic typed state transformations", async () => {
  const { tools, getResult } = createFlowAssistantTools({
    initialGraph: emptyGraph,
    allowedAgents,
  });

  const result = await invokeTool<{ id: string }>(tools.addTransformNode, {
    label: "Derive change signals",
    assignments: [
      {
        key: "tests_changed",
        source: "metadata.changed_files",
        operation: "files_match_glob",
        argument: "**/*.test.ts",
      },
      {
        key: "file_count",
        source: "metadata.changed_files",
        operation: "array_length",
      },
    ],
  });

  const node = getResult().graph.nodes.find(
    (candidate) => candidate.id === result.id
  );
  assert.ok(node?.type === "transform");
  assert.deepEqual(node.data, {
    label: "Derive change signals",
    assignments: [
      {
        key: "tests_changed",
        source: "metadata.changed_files",
        operation: "files_match_glob",
        argument: "**/*.test.ts",
      },
      {
        key: "file_count",
        source: "metadata.changed_files",
        operation: "array_length",
      },
    ],
  });
});

test("connect with missing source returns error", async () => {
  const { tools, getResult } = createFlowAssistantTools({
    initialGraph: emptyGraph,
    allowedAgents,
  });

  // Create only an end node
  await invokeTool(tools.setEnd, { label: "Done" });

  const result = await invokeTool<{ error?: string; id?: string }>(
    tools.connect,
    { source: "nonexistent", target: "end" }
  );

  assert.ok(result.error);
  assert.ok(result.error.includes("nonexistent"));
  assert.equal(getResult().graph.edges.length, 0);
});

test("connect with missing target returns error", async () => {
  const { tools, getResult } = createFlowAssistantTools({
    initialGraph: emptyGraph,
    allowedAgents,
  });

  // Create only a start node
  await invokeTool(tools.setStart, { label: "Start", event: "pr_opened" });

  const result = await invokeTool<{ error?: string; id?: string }>(
    tools.connect,
    { source: "start", target: "nonexistent" }
  );

  assert.ok(result.error);
  assert.ok(result.error.includes("nonexistent"));
  assert.equal(getResult().graph.edges.length, 0);
});

test("connect with self-loop returns error", async () => {
  const { tools, getResult } = createFlowAssistantTools({
    initialGraph: emptyGraph,
    allowedAgents,
  });

  await invokeTool(tools.setStart, { label: "Start", event: "pr_opened" });

  const result = await invokeTool<{ error?: string; id?: string }>(
    tools.connect,
    { source: "start", target: "start" }
  );

  assert.ok(result.error);
  assert.ok(result.error.includes("itself"));
  assert.equal(getResult().graph.edges.length, 0);
});

test("connect with valid args returns id and appends edge", async () => {
  const { tools, getResult } = createFlowAssistantTools({
    initialGraph: emptyGraph,
    allowedAgents,
  });

  await invokeTool(tools.setStart, { label: "Start", event: "pr_opened" });
  await invokeTool(tools.setEnd, { label: "Done" });

  const result = await invokeTool<{ id: string }>(tools.connect, {
    source: "start",
    target: "end",
  });

  assert.ok(result.id);
  assert.ok(result.id.startsWith("edge-"));

  const graph = getResult().graph;
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.edges[0].source, "start");
  assert.equal(graph.edges[0].target, "end");
});

test("connect rejects duplicate edges with identical handles", async () => {
  const { tools, getResult } = createFlowAssistantTools({
    initialGraph: emptyGraph,
    allowedAgents,
  });

  await invokeTool(tools.setStart, { label: "Start", event: "pr_opened" });
  await invokeTool(tools.setEnd, { label: "Done" });

  await invokeTool(tools.connect, { source: "start", target: "end" });
  const second = await invokeTool<{ error?: string; id?: string }>(
    tools.connect,
    { source: "start", target: "end" }
  );

  assert.ok(second.error);
  assert.ok(second.error.includes("already exists"));
  assert.equal(second.id, undefined);
  assert.equal(getResult().graph.edges.length, 1);
});

test("connect allows same source/target when handles differ", async () => {
  const { tools, getResult } = createFlowAssistantTools({
    initialGraph: emptyGraph,
    allowedAgents,
  });

  await invokeTool(tools.setStart, { label: "Start", event: "pr_opened" });
  const cond = await invokeTool<{ id: string }>(tools.addConditionNode, {
    label: "Branch",
    field: "payload.kind",
    operator: "equals",
    value: "bug",
  });
  const agent = await invokeTool<{ id: string }>(tools.addAgentNode, {
    label: "Triage",
    agentId: "agent-1",
  });

  await invokeTool(tools.connect, {
    source: cond.id,
    target: agent.id,
    sourceHandle: "true",
  });
  const second = await invokeTool<{ id?: string; error?: string }>(
    tools.connect,
    { source: cond.id, target: agent.id, sourceHandle: "false" }
  );

  assert.ok(second.id);
  assert.equal(second.error, undefined);
  assert.equal(getResult().graph.edges.length, 2);
});

test("getGraph returns a clone that cannot mutate internal state", async () => {
  const { tools, getResult } = createFlowAssistantTools({
    initialGraph: emptyGraph,
    allowedAgents,
  });

  await invokeTool(tools.setStart, { label: "Start", event: "pr_opened" });

  const snapshot = await invokeTool<{ graph: FlowGraph }>(tools.getGraph, {});
  snapshot.graph.nodes.push({
    id: "injected",
    type: "end",
    position: { x: 0, y: 0 },
    data: { label: "Injected" },
  });
  snapshot.graph.edges.push({ id: "bad", source: "x", target: "y" });

  const internal = getResult().graph;
  assert.equal(internal.nodes.length, 1);
  assert.equal(internal.nodes[0].id, "start");
  assert.equal(internal.edges.length, 0);
});

test("removeNode cascades edge removal", async () => {
  const { tools, getResult } = createFlowAssistantTools({
    initialGraph: emptyGraph,
    allowedAgents,
  });

  await invokeTool(tools.setStart, { label: "Start", event: "pr_opened" });
  const agentResult = await invokeTool<{ id: string }>(tools.addAgentNode, {
    label: "Agent",
    agentId: "agent-1",
  });
  await invokeTool(tools.setEnd, { label: "Done" });

  // Connect start -> agent -> end
  await invokeTool(tools.connect, { source: "start", target: agentResult.id });
  await invokeTool(tools.connect, { source: agentResult.id, target: "end" });

  const graphBefore = getResult().graph;
  assert.equal(graphBefore.nodes.length, 3);
  assert.equal(graphBefore.edges.length, 2);

  // Remove the agent node
  const removeResult = await invokeTool<{ ok?: boolean; error?: string }>(
    tools.removeNode,
    { id: agentResult.id }
  );

  assert.equal(removeResult.ok, true);

  const graphAfter = getResult().graph;
  assert.equal(graphAfter.nodes.length, 2); // start and end remain
  assert.equal(graphAfter.edges.length, 0); // both edges removed
});

test("removeNode with id 'start' returns error", async () => {
  const { tools, getResult } = createFlowAssistantTools({
    initialGraph: emptyGraph,
    allowedAgents,
  });

  await invokeTool(tools.setStart, { label: "Start", event: "pr_opened" });

  const result = await invokeTool<{ error?: string; ok?: boolean }>(
    tools.removeNode,
    { id: "start" }
  );

  assert.ok(result.error);
  assert.ok(result.error.includes("setStart"));
  assert.equal(getResult().graph.nodes.length, 1); // start still exists
});

test("removeNode with id 'end' returns error", async () => {
  const { tools, getResult } = createFlowAssistantTools({
    initialGraph: emptyGraph,
    allowedAgents,
  });

  await invokeTool(tools.setEnd, { label: "Done" });

  const result = await invokeTool<{ error?: string; ok?: boolean }>(
    tools.removeNode,
    { id: "end" }
  );

  assert.ok(result.error);
  assert.ok(result.error.includes("setEnd"));
  assert.equal(getResult().graph.nodes.length, 1); // end still exists
});

test("finalize returns errors when graph is invalid", async () => {
  const { tools, getResult } = createFlowAssistantTools({
    initialGraph: emptyGraph,
    allowedAgents,
  });

  // No start or end node — graph is invalid
  const result = await invokeTool<{ ok: boolean; errors?: string[] }>(
    tools.finalize,
    { summary: "Test flow" }
  );

  assert.equal(result.ok, false);
  assert.ok(Array.isArray(result.errors));
  assert.ok(result.errors.length > 0);

  // getResult should not be done
  assert.equal(getResult().done, false);
  assert.equal(getResult().summary, null);
});

test("finalize returns ok and sets done on valid graph", async () => {
  const { tools, getResult } = createFlowAssistantTools({
    initialGraph: emptyGraph,
    allowedAgents,
  });

  // Build a valid minimal graph: start -> agent -> end
  await invokeTool(tools.setStart, { label: "PR opened", event: "pr_opened" });
  const agentResult = await invokeTool<{ id: string }>(tools.addAgentNode, {
    label: "Reviewer",
    agentId: "agent-1",
    role: "review",
  });
  await invokeTool(tools.setEnd, { label: "Done" });
  await invokeTool(tools.connect, { source: "start", target: agentResult.id });
  await invokeTool(tools.connect, { source: agentResult.id, target: "end" });

  const result = await invokeTool<{ ok: boolean; errors?: string[] }>(
    tools.finalize,
    { summary: "Reviews PRs when opened" }
  );

  assert.equal(result.ok, true);
  assert.equal(result.errors, undefined);

  const finalResult = getResult();
  assert.equal(finalResult.done, true);
  assert.equal(finalResult.summary, "Reviews PRs when opened");
});

test("finalize self-heal: fails on invalid graph, fixes, finalizes", async () => {
  const { tools, getResult } = createFlowAssistantTools({
    initialGraph: emptyGraph,
    allowedAgents,
  });

  // First attempt: only a start node. Should fail validation.
  await invokeTool(tools.setStart, { label: "PR opened", event: "pr_opened" });
  const firstAttempt = await invokeTool<{ ok: boolean; errors?: string[] }>(
    tools.finalize,
    { summary: "Premature" }
  );
  assert.equal(firstAttempt.ok, false);
  assert.ok(Array.isArray(firstAttempt.errors));
  assert.ok(firstAttempt.errors.length > 0);
  assert.equal(getResult().done, false);
  assert.equal(getResult().summary, null);

  // Fix: add the missing agent, end node, and edges.
  const agent = await invokeTool<{ id: string }>(tools.addAgentNode, {
    label: "Reviewer",
    agentId: "agent-1",
    role: "review",
  });
  await invokeTool(tools.setEnd, { label: "Done" });
  await invokeTool(tools.connect, { source: "start", target: agent.id });
  await invokeTool(tools.connect, { source: agent.id, target: "end" });

  // Second attempt: should succeed.
  const secondAttempt = await invokeTool<{ ok: boolean; errors?: string[] }>(
    tools.finalize,
    { summary: "Reviews PRs when opened" }
  );
  assert.equal(secondAttempt.ok, true);
  assert.equal(secondAttempt.errors, undefined);

  const finalResult = getResult();
  assert.equal(finalResult.done, true);
  assert.equal(finalResult.summary, "Reviews PRs when opened");
});

test("getResult returns a clone that cannot mutate internal state", async () => {
  const { tools, getResult } = createFlowAssistantTools({
    initialGraph: emptyGraph,
    allowedAgents,
  });

  await invokeTool(tools.setStart, { label: "Start", event: "pr_opened" });

  const snapshot = getResult();
  snapshot.graph.nodes.push({
    id: "injected",
    type: "end",
    position: { x: 0, y: 0 },
    data: { label: "Injected" },
  });
  snapshot.graph.edges.push({ id: "bad", source: "x", target: "y" });

  const fresh = getResult();
  assert.equal(fresh.graph.nodes.length, 1);
  assert.equal(fresh.graph.nodes[0].id, "start");
  assert.equal(fresh.graph.edges.length, 0);
});

test("setStart replaces existing start node", async () => {
  const { tools, getResult } = createFlowAssistantTools({
    initialGraph: emptyGraph,
    allowedAgents,
  });

  // Create first start node
  await invokeTool(tools.setStart, { label: "First", event: "pr_opened" });
  assert.equal(getResult().graph.nodes.length, 1);
  assert.equal(getResult().graph.nodes[0].data.label, "First");

  // Create second start node — should replace
  await invokeTool(tools.setStart, { label: "Second", event: "mention" });

  const graph = getResult().graph;
  assert.equal(graph.nodes.length, 1); // Still only one start node
  assert.equal(graph.nodes[0].data.label, "Second");
  const startNode = graph.nodes[0];
  assert.equal(startNode.type, "start");
  if (startNode.type === "start") {
    assert.equal(startNode.data.event, "mention");
  }
});

test("addConditionNode returns handles object", async () => {
  const { tools } = createFlowAssistantTools({
    initialGraph: emptyGraph,
    allowedAgents,
  });

  const result = await invokeTool<{
    id: string;
    handles: { then: string; else: string };
  }>(tools.addConditionNode, {
    label: "Check status",
    field: "status",
    operator: "equals",
    value: "open",
  });

  assert.ok(result.id);
  assert.ok(result.id.startsWith("condition-"));
  assert.deepEqual(result.handles, { then: "true", else: "false" });
});
