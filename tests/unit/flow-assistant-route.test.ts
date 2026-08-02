import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultFlowGraph } from "../../lib/flows/graph";

async function loadFlowAssistantRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/flows/[id]/assistant/route");
}

function makeRequest(body: unknown, headers?: HeadersInit) {
  const requestHeaders = new Headers({ "Content-Type": "application/json" });
  for (const [key, value] of new Headers(headers).entries()) {
    requestHeaders.set(key, value);
  }
  return new Request("http://localhost/api/flows/flow-1/assistant", {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify(body),
  });
}

const params = Promise.resolve({ id: "flow-1" });

test("POST /api/flows/[id]/assistant forwards the active team header", async () => {
  const { createFlowAssistantPostHandler } = await loadFlowAssistantRoute();
  const graph = createDefaultFlowGraph({
    agentId: "agent-1",
    agentName: "Agent",
  });
  const calls: Array<{
    userId: string;
    flowId: string;
    teamId?: string | null;
    capabilities?: string[];
  }> = [];
  const capabilities = new Set(["models.*"]);
  const handler = createFlowAssistantPostHandler({
    requireUserId: async () => "user-1",
    loadOwnedFlow: (async () => ({
      id: "flow-1",
      draft_graph: graph,
    })) as never,
    generateFlowAssistantSuggestion: (async (input: {
      userId: string;
      flowId: string;
      teamId?: string | null;
      capabilities?: ReadonlySet<string>;
    }) => {
      calls.push({
        userId: input.userId,
        flowId: input.flowId,
        teamId: input.teamId,
        capabilities: Array.from(input.capabilities ?? []),
      });
      return {
        summary: "Kept the graph",
        graph,
      };
    }) as never,
    resolveActiveTeamCapabilities: async (_userId, teamId) => ({
      ok: true,
      teamId: teamId ?? null,
      capabilities,
    }),
  });

  const response = await handler(
    makeRequest(
      { message: "Keep it simple" },
      { "x-mogplex-team-id": " 00000000-0000-4000-8000-000000000001 " }
    ),
    { params }
  );

  assert.equal(response.status, 200);
  assert.equal((await response.json()).summary, "Kept the graph");
  assert.deepEqual(calls, [
    {
      userId: "user-1",
      flowId: "flow-1",
      teamId: "00000000-0000-4000-8000-000000000001",
      capabilities: ["models.*"],
    },
  ]);
});

test("POST /api/flows/[id]/assistant rejects invalid active team", async () => {
  const { createFlowAssistantPostHandler } = await loadFlowAssistantRoute();
  const graph = createDefaultFlowGraph({
    agentId: "agent-1",
    agentName: "Agent",
  });
  let generateCalls = 0;
  const handler = createFlowAssistantPostHandler({
    requireUserId: async () => "user-1",
    loadOwnedFlow: (async () => ({
      id: "flow-1",
      draft_graph: graph,
    })) as never,
    generateFlowAssistantSuggestion: (async () => {
      generateCalls += 1;
      return {
        summary: "Kept the graph",
        graph,
      };
    }) as never,
    resolveActiveTeamCapabilities: async () => ({
      ok: false,
      status: 403,
      error: "Forbidden",
    }),
  });

  const response = await handler(
    makeRequest(
      { message: "Keep it simple" },
      { "x-mogplex-team-id": "00000000-0000-4000-8000-000000000001" }
    ),
    { params }
  );

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "Forbidden" });
  assert.equal(generateCalls, 0);
});
