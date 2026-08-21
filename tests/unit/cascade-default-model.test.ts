import assert from "node:assert/strict";
import test from "node:test";

import {
  cascadeDefaultModelToAutomations,
  rewriteFlowGraphModelPins,
  type CascadeAutomationModelDeps,
} from "../../lib/flows/cascade-default-model";
import { createDefaultFlowGraph } from "../../lib/flows/graph";
import type { FlowGraph } from "../../lib/types/flow";

const OLD_MODEL = "minimax/minimax-m2.7";
const NEW_MODEL = "openai/gpt-5.4";
const OTHER_MODEL = "anthropic/claude-sonnet-4.6";

function graphWithModels(
  models: Array<string | null>,
  extra?: { fallback?: string | null }
): FlowGraph {
  const graph = createDefaultFlowGraph({ modelId: models[0] ?? null });
  for (const [index, model] of models.entries()) {
    if (index === 0) continue;
    graph.nodes.push({
      id: `agent-${index + 1}`,
      type: "agent",
      position: { x: 0, y: 0 },
      data: {
        label: `Agent ${index + 1}`,
        agentId: null,
        modelOverride: model,
        maxStepsOverride: null,
        timeoutMsOverride: null,
        systemPromptOverride: null,
      },
    });
  }
  if (extra && "fallback" in extra) {
    const agent = graph.nodes.find((node) => node.type === "agent");
    if (agent?.type === "agent") {
      agent.data.fallbackModelOverride = extra.fallback ?? null;
    }
  }
  return graph;
}

function makeDeps(overrides: Partial<CascadeAutomationModelDeps> = {}) {
  const calls = {
    savedDrafts: [] as Array<{ flowId: string; graph: FlowGraph }>,
    insertedVersions: [] as Array<{
      flowId: string;
      versionNumber: number;
      graph: FlowGraph;
    }>,
    publishedPointers: [] as Array<{ flowId: string; versionId: string }>,
  };
  const deps: CascadeAutomationModelDeps = {
    loadFlows: async () => [],
    loadPublishedVersionGraph: async () => null,
    loadLatestVersionNumber: async () => 1,
    saveDraftGraph: async (flowId, _userId, graph) => {
      calls.savedDrafts.push({ flowId, graph });
    },
    insertFlowVersion: async (input) => {
      calls.insertedVersions.push(input);
      return { id: `version-${input.flowId}-${input.versionNumber}` };
    },
    setPublishedVersion: async (flowId, _userId, versionId) => {
      calls.publishedPointers.push({ flowId, versionId });
    },
    ...overrides,
  };
  return { deps, calls };
}

test("rewriteFlowGraphModelPins rewrites only agent pins matching the old default", () => {
  const graph = graphWithModels([OLD_MODEL, OTHER_MODEL, OLD_MODEL], {
    fallback: OLD_MODEL,
  });

  const { graph: rewritten, replaced } = rewriteFlowGraphModelPins(
    graph,
    new Set([OLD_MODEL]),
    NEW_MODEL
  );

  assert.equal(replaced, 2);
  const agents = rewritten.nodes.filter((node) => node.type === "agent");
  assert.deepEqual(
    agents.map((node) => node.data.modelOverride),
    [NEW_MODEL, OTHER_MODEL, NEW_MODEL]
  );
  // An explicit fallback pin is a deliberate user pick and stays put.
  assert.equal(agents[0].data.fallbackModelOverride, OLD_MODEL);
  // Non-agent nodes are untouched.
  assert.equal(rewritten.nodes[0].type, "start");
  assert.equal(rewritten.edges, graph.edges);
});

test("rewriteFlowGraphModelPins returns the input graph when nothing matches", () => {
  const graph = graphWithModels([OTHER_MODEL]);
  const result = rewriteFlowGraphModelPins(
    graph,
    new Set([OLD_MODEL]),
    NEW_MODEL
  );
  assert.equal(result.replaced, 0);
  assert.equal(result.graph, graph);
});

test("cascade rewrites drafts and publishes a new version for published flows", async () => {
  const publishedGraph = graphWithModels([OLD_MODEL]);
  const { deps, calls } = makeDeps({
    loadFlows: async () => [
      {
        id: "flow-published",
        draft_graph: graphWithModels([OLD_MODEL]),
        published_version_id: "version-1",
      },
      {
        id: "flow-draft-only",
        draft_graph: graphWithModels([OLD_MODEL]),
        published_version_id: null,
      },
      {
        id: "flow-untouched",
        draft_graph: graphWithModels([OTHER_MODEL]),
        published_version_id: "version-2",
      },
    ],
    loadPublishedVersionGraph: async (versionId) =>
      versionId === "version-1"
        ? { id: "version-1", graph: publishedGraph }
        : { id: versionId, graph: graphWithModels([OTHER_MODEL]) },
    loadLatestVersionNumber: async () => 4,
  });

  const result = await cascadeDefaultModelToAutomations(
    { userId: "user-1", previousModelIds: [OLD_MODEL], nextModelId: NEW_MODEL },
    deps
  );

  assert.deepEqual(result, {
    draftsUpdated: 2,
    versionsPublished: 1,
    failed: 0,
  });
  assert.deepEqual(
    calls.savedDrafts.map((entry) => entry.flowId),
    ["flow-published", "flow-draft-only"]
  );
  assert.equal(calls.insertedVersions.length, 1);
  assert.equal(calls.insertedVersions[0].flowId, "flow-published");
  assert.equal(calls.insertedVersions[0].versionNumber, 5);
  const agent = calls.insertedVersions[0].graph.nodes.find(
    (node) => node.type === "agent"
  );
  assert.equal(agent?.type === "agent" && agent.data.modelOverride, NEW_MODEL);
  assert.deepEqual(calls.publishedPointers, [
    { flowId: "flow-published", versionId: "version-flow-published-5" },
  ]);
});

test("cascade isolates per-flow failures and keeps sweeping", async () => {
  const { deps, calls } = makeDeps({
    loadFlows: async () => [
      {
        id: "flow-broken",
        draft_graph: graphWithModels([OLD_MODEL]),
        published_version_id: null,
      },
      {
        id: "flow-fine",
        draft_graph: graphWithModels([OLD_MODEL]),
        published_version_id: null,
      },
    ],
    saveDraftGraph: async (flowId, _userId, graph) => {
      if (flowId === "flow-broken") throw new Error("db down");
      calls.savedDrafts.push({ flowId, graph });
    },
  });

  const result = await cascadeDefaultModelToAutomations(
    { userId: "user-1", previousModelIds: [OLD_MODEL], nextModelId: NEW_MODEL },
    deps
  );

  assert.deepEqual(result, {
    draftsUpdated: 1,
    versionsPublished: 0,
    failed: 1,
  });
  assert.deepEqual(
    calls.savedDrafts.map((entry) => entry.flowId),
    ["flow-fine"]
  );
});

test("cascade short-circuits when there are no previous model ids", async () => {
  let loadCalls = 0;
  const { deps } = makeDeps({
    loadFlows: async () => {
      loadCalls += 1;
      return [];
    },
  });

  const result = await cascadeDefaultModelToAutomations(
    { userId: "user-1", previousModelIds: [], nextModelId: NEW_MODEL },
    deps
  );

  assert.deepEqual(result, {
    draftsUpdated: 0,
    versionsPublished: 0,
    failed: 0,
  });
  assert.equal(loadCalls, 0);
});
