import assert from "node:assert/strict";
import test from "node:test";
import { validateFlowGraph } from "@/lib/flows/graph";
import {
  bindFlowGraphToScope,
  bindFlowGraphToInstallation,
  buildFlowStarterTemplateGraph,
  FLOW_STARTER_TEMPLATES,
  flowTemplateRequiresRepository,
  getFlowTemplateReconnects,
  getFlowStarterTemplate,
  isFlowStarterTemplateId,
  preparePersonalFlowTemplateGraphForValidation,
  sanitizeFlowGraphForPersonalTemplate,
  sanitizeFlowGraphForTeamTemplate,
} from "@/lib/flows/templates";
import type { FlowGraph } from "@/lib/types";

test("every workflow starter template builds a valid bound graph", () => {
  for (const template of FLOW_STARTER_TEMPLATES) {
    const graph = bindFlowGraphToInstallation(
      buildFlowStarterTemplateGraph({
        templateId: template.id,
        agentId: "agent-1",
        agentName: "Primary agent",
      }),
      101
    );
    const start = graph.nodes.find((node) => node.type === "start");

    assert.deepEqual(validateFlowGraph(graph), {
      valid: true,
      errors: [],
    });
    assert.deepEqual(start?.data.filter?.installationIds, [101]);
  }
});

test("Dependabot autopilot is scoped and explicitly opts into repair and merge", () => {
  const graph = bindFlowGraphToInstallation(
    buildFlowStarterTemplateGraph({
      templateId: "dependabot-autopilot",
      agentId: "agent-1",
      agentName: "Primary agent",
    }),
    101
  );
  const start = graph.nodes.find((node) => node.type === "start");
  const agent = graph.nodes.find((node) => node.type === "agent");

  assert.equal(start?.data.event, "pr_opened");
  assert.deepEqual(start?.data.filter?.installationIds, [101]);
  assert.equal(start?.data.filter?.authorFilter, "dependabot_only");
  assert.equal(agent?.data.role, "review");
  assert.equal(agent?.data.autofix, true);
  assert.equal(agent?.data.autofixSandbox, true);
  assert.equal(agent?.data.autoMerge, true);
});

test("workflow starter template ids are validated at the API boundary", () => {
  assert.equal(isFlowStarterTemplateId("pr-review"), true);
  assert.equal(isFlowStarterTemplateId("unknown-template"), false);
  assert.equal(
    getFlowStarterTemplate("issue-triage").description,
    "Analyze each new issue and recommend next steps."
  );
});

test("personal workflow templates strip target and Slack connection bindings", () => {
  const graph: FlowGraph = {
    nodes: [
      {
        id: "start",
        type: "start",
        position: { x: 80, y: 140 },
        data: {
          label: "Slack mention",
          event: "slack_mention",
          filter: {
            scope: "all",
            installationIds: [101],
            repos: ["acme/source"],
          },
          slackTeamId: "team-1",
          slackChannelId: "channel-1",
          slackChannelName: "review",
        },
      },
      {
        id: "agent",
        type: "agent",
        position: { x: 360, y: 140 },
        data: {
          label: "Reviewer",
          agentId: "agent-1",
          role: "review",
          modelOverride: "openai/gpt-5.4",
        },
      },
      {
        id: "notify",
        type: "action",
        position: { x: 620, y: 140 },
        data: {
          label: "Notify Slack",
          operation: "slack.send_message",
          destination: "channel",
          teamId: "team-1",
          channelId: "channel-2",
          channelName: "deploys",
          message: "Review complete",
        },
      },
      {
        id: "end",
        type: "end",
        position: { x: 880, y: 140 },
        data: { label: "Done" },
      },
    ],
    edges: [
      { id: "start-agent", source: "start", target: "agent" },
      { id: "agent-notify", source: "agent", target: "notify" },
      { id: "notify-end", source: "notify", target: "end" },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  };

  assert.deepEqual(validateFlowGraph(graph), { valid: true, errors: [] });

  const templateGraph = sanitizeFlowGraphForPersonalTemplate(graph);
  const templateStart = templateGraph.nodes.find(
    (node) => node.type === "start"
  );
  const templateSlackAction = templateGraph.nodes.find(
    (node) =>
      node.type === "action" && node.data.operation === "slack.send_message"
  );

  assert.deepEqual(templateStart?.data.filter, { scope: "all" });
  assert.equal(templateStart?.data.slackTeamId, undefined);
  assert.equal(templateStart?.data.slackChannelId, undefined);
  assert.ok(
    templateSlackAction?.type === "action" &&
      templateSlackAction.data.operation === "slack.send_message"
  );
  assert.equal(templateSlackAction.data.teamId, "");
  assert.equal(templateSlackAction.data.channelId, "");
  assert.deepEqual(getFlowTemplateReconnects(templateGraph), ["slack"]);
  assert.equal(flowTemplateRequiresRepository(templateGraph), true);
  assert.deepEqual(
    validateFlowGraph(
      preparePersonalFlowTemplateGraphForValidation(templateGraph)
    ),
    { valid: true, errors: [] }
  );

  const instantiated = bindFlowGraphToScope(templateGraph, {
    installationId: 202,
    repository: "alex/priority-project",
  });
  const instantiatedStart = instantiated.nodes.find(
    (node) => node.type === "start"
  );
  assert.deepEqual(instantiatedStart?.data.filter, {
    scope: "all",
    installationIds: [202],
    repos: ["alex/priority-project"],
  });
  assert.equal(instantiatedStart?.data.slackTeamId, undefined);
});

// A new graph is born pinned to a model, and the constant is a build-time
// value that a given workspace may not be able to invoke. Every template must
// carry the caller's resolved model through instead of hardcoding one.
test("every starter template pins the model the caller resolved", () => {
  for (const template of FLOW_STARTER_TEMPLATES) {
    const graph = buildFlowStarterTemplateGraph({
      templateId: template.id,
      agentId: "agent-1",
      agentName: "Primary agent",
      modelId: "openai/gpt-5",
    });
    const agent = graph.nodes.find((node) => node.type === "agent");
    assert.equal(
      agent?.data.modelOverride,
      "openai/gpt-5",
      `${template.id} dropped the caller's model`
    );
  }
});

test("starter templates still produce a publishable graph with no model resolved", () => {
  for (const template of FLOW_STARTER_TEMPLATES) {
    const graph = buildFlowStarterTemplateGraph({
      templateId: template.id,
      agentId: "agent-1",
      agentName: "Primary agent",
      modelId: null,
    });
    const agent = graph.nodes.find((node) => node.type === "agent");
    // Falling back to the constant keeps the graph publishable; leaving it
    // empty would make a brand-new flow unpublishable on arrival.
    assert.ok(
      (agent?.data.modelOverride ?? "").length > 0,
      `${template.id} produced an agent node with no model`
    );
  }
});

test("webhook templates report a fresh secret requirement", () => {
  const graph = buildFlowStarterTemplateGraph({
    templateId: "pr-review",
    agentId: "agent-1",
    agentName: "Primary agent",
  });
  const start = graph.nodes.find((node) => node.type === "start");
  assert.ok(start?.type === "start");
  start.data.event = "webhook";

  assert.deepEqual(getFlowTemplateReconnects(graph), ["webhook"]);
  assert.equal(flowTemplateRequiresRepository(graph), true);
});

test("team workflow templates remove private agent bindings", () => {
  const graph = buildFlowStarterTemplateGraph({
    templateId: "pr-review",
    agentId: "agent-private",
    agentName: "Private reviewer",
  });

  const personalGraph = sanitizeFlowGraphForPersonalTemplate(graph);
  const personalAgent = personalGraph.nodes.find(
    (node) => node.type === "agent"
  );
  assert.equal(personalAgent?.data.agentId, "agent-private");

  const teamGraph = sanitizeFlowGraphForTeamTemplate(graph);
  const teamAgent = teamGraph.nodes.find((node) => node.type === "agent");
  assert.equal(teamAgent?.data.agentId, null);
  assert.deepEqual(getFlowTemplateReconnects(teamGraph), ["agent"]);
  assert.deepEqual(
    validateFlowGraph(
      preparePersonalFlowTemplateGraphForValidation(teamGraph),
      { requireRunnableConfig: false }
    ),
    { valid: true, errors: [] }
  );
});
