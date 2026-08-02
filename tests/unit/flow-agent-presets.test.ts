import assert from "node:assert/strict";
import test from "node:test";
import { FlowServiceError } from "../../lib/flows/errors";
import type { FlowGraph } from "../../lib/types";

async function loadFlowServer() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../lib/flows/server");
}

function buildGraph(agentId: string): FlowGraph {
  return {
    nodes: [
      {
        id: "start",
        type: "start",
        position: { x: 0, y: 0 },
        data: { label: "@mogplex", event: "mention", isDefault: true },
      },
      {
        id: "agent-1",
        type: "agent",
        position: { x: 100, y: 0 },
        data: { label: "NEXTJS-REVIEWER", agentId },
      },
      {
        id: "end",
        type: "end",
        position: { x: 200, y: 0 },
        data: { label: "Done" },
      },
    ],
    edges: [
      { id: "e1", source: "start", target: "agent-1" },
      { id: "e2", source: "agent-1", target: "end" },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

test("resolveFlowGraphPresetAgents resolves a preset through the template resolver", async () => {
  const { resolveFlowGraphPresetAgents } = await loadFlowServer();
  let resolveCalls = 0;

  const graph = await resolveFlowGraphPresetAgents(
    "user-1",
    buildGraph("preset:NEXTJS-REVIEWER"),
    {
      resolveTemplateAgentFork: async (_userId, template) => {
        resolveCalls += 1;
        assert.equal(template.name, "NEXTJS-REVIEWER");
        return { id: "11111111-1111-4111-8111-111111111111" };
      },
    }
  );

  const agentNode = graph.nodes.find((node) => node.type === "agent");
  assert.equal(
    agentNode?.type === "agent" ? agentNode.data.agentId : null,
    "11111111-1111-4111-8111-111111111111"
  );
  assert.equal(resolveCalls, 1);
});

test("resolveFlowGraphPresetAgents forwards the active team scope to the fork resolver", async () => {
  const { resolveFlowGraphPresetAgents } = await loadFlowServer();
  const seenTeamIds: Array<string | null> = [];
  const deps = {
    resolveTemplateAgentFork: async (
      _userId: string,
      _template: unknown,
      teamId: string | null
    ) => {
      seenTeamIds.push(teamId);
      return { id: "33333333-3333-4333-8333-333333333333" };
    },
  };

  await resolveFlowGraphPresetAgents(
    "user-1",
    buildGraph("preset:NEXTJS-REVIEWER"),
    deps,
    "44444444-4444-4444-8444-444444444444"
  );
  await resolveFlowGraphPresetAgents(
    "user-1",
    buildGraph("preset:NEXTJS-REVIEWER"),
    deps
  );

  assert.deepEqual(seenTeamIds, ["44444444-4444-4444-8444-444444444444", null]);
});

test("resolveFlowGraphPresetAgents caches repeated preset ids in one graph", async () => {
  const { resolveFlowGraphPresetAgents } = await loadFlowServer();
  let resolveCalls = 0;
  const graph = buildGraph("preset:NEXTJS-REVIEWER");
  graph.nodes.splice(2, 0, {
    id: "agent-2",
    type: "agent",
    position: { x: 150, y: 0 },
    data: { label: "NEXTJS-REVIEWER", agentId: "preset:NEXTJS-REVIEWER" },
  });

  const resolvedGraph = await resolveFlowGraphPresetAgents("user-1", graph, {
    resolveTemplateAgentFork: async (_userId, template) => {
      resolveCalls += 1;
      assert.equal(template.name, "NEXTJS-REVIEWER");
      return { id: "22222222-2222-4222-8222-222222222222" };
    },
  });

  const agentIds = resolvedGraph.nodes
    .filter((node) => node.type === "agent")
    .map((node) => (node.type === "agent" ? node.data.agentId : null));
  assert.deepEqual(agentIds, [
    "22222222-2222-4222-8222-222222222222",
    "22222222-2222-4222-8222-222222222222",
  ]);
  assert.equal(resolveCalls, 1);
});

test("resolveFlowGraphPresetAgents throws FLOW_STORAGE_FAILED when fork returns null", async () => {
  // Covers the branch where the atomic template resolver returns no row even
  // though the template exists in PRECONFIGURED_AGENTS.
  // resolveFlowGraphPresetAgents should throw rather than silently produce a
  // graph with an unresolved preset: ID.
  // The user-facing message is intentionally generic; the specific template
  // name is preserved in error.cause for server-side observability only.
  const { resolveFlowGraphPresetAgents } = await loadFlowServer();

  await assert.rejects(
    () =>
      resolveFlowGraphPresetAgents(
        "user-1",
        buildGraph("preset:NEXTJS-REVIEWER"),
        {
          resolveTemplateAgentFork: async () => null,
        }
      ),
    /One or more agents could not be provisioned/
  );
});

test("resolveFlowGraphPresetAgents propagates resolver throws", async () => {
  // Contract: errors thrown by the resolver are re-thrown verbatim (not
  // wrapped). The defaultFlowPresetAgentResolverDeps wrapper in server.ts
  // re-wraps AgentTemplateForkError as FlowServiceError before reaching here,
  // but this test exercises the raw deps seam directly, so the original Error
  // must be the one that surfaces.
  const { resolveFlowGraphPresetAgents } = await loadFlowServer();

  await assert.rejects(
    () =>
      resolveFlowGraphPresetAgents(
        "user-1",
        buildGraph("preset:NEXTJS-REVIEWER"),
        {
          resolveTemplateAgentFork: async () => {
            throw new Error("db error");
          },
        }
      ),
    (error) => error instanceof Error && error.message.includes("db error")
  );
});

test("resolveFlowGraphPresetAgents rejects unknown presets before verification", async () => {
  // The user-facing message is intentionally generic; the specific template
  // name is preserved in error.cause for server-side observability only.
  const { resolveFlowGraphPresetAgents } = await loadFlowServer();

  await assert.rejects(
    () =>
      resolveFlowGraphPresetAgents("user-1", buildGraph("preset:NOPE"), {
        resolveTemplateAgentFork: async () => null,
      }),
    /One or more agents are not available to this user/
  );
});

test("assertOwnedFlowGraphAgents rejects malformed agent ids before Supabase UUID filtering", async () => {
  const { assertOwnedFlowGraphAgents } = await loadFlowServer();

  await assert.rejects(
    () =>
      assertOwnedFlowGraphAgents(
        "user-1",
        buildGraph("preset:NEXTJS-REVIEWER")
      ),
    (error) => {
      assert.ok(error instanceof FlowServiceError);
      assert.equal(
        error.message,
        "One or more agents are not available to this user."
      );
      assert.match(
        String(error.cause),
        /Malformed agent ID rejected: "preset:NEXTJS-REVIEWER"/
      );
      return true;
    }
  );
});
