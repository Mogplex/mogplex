import assert from "node:assert/strict";
import test from "node:test";
import { createFlowAssistantTools } from "../../lib/flows/assistant-tools";
import type { FlowNode } from "../../lib/types";
import {
  emptyGraph,
  allowedAgents,
  invokeTool,
  agentNodeModel,
} from "./helpers/flow-assistant-tools-fixtures";

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

  await invokeTool(tools.connect, { source: "start", target: agentResult.id });
  await invokeTool(tools.connect, { source: agentResult.id, target: "end" });

  const graphBefore = getResult().graph;
  assert.equal(graphBefore.nodes.length, 3);
  assert.equal(graphBefore.edges.length, 2);

  const removeResult = await invokeTool<{ ok?: boolean; error?: string }>(
    tools.removeNode,
    { id: agentResult.id }
  );

  assert.equal(removeResult.ok, true);

  const graphAfter = getResult().graph;
  assert.equal(graphAfter.nodes.length, 2);
  assert.equal(graphAfter.edges.length, 0);
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
  assert.equal(getResult().graph.nodes.length, 1);
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
  assert.equal(getResult().graph.nodes.length, 1);
});
