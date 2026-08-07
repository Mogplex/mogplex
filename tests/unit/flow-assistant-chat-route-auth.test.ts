import assert from "node:assert/strict";
import test from "node:test";
import {
  loadFlowAssistantChatRoute,
  makeRequest,
  params,
  allowLimits,
  noopRelease,
  noopRecord,
  createReleaseProbe,
} from "./helpers/flow-assistant-chat-route-fixtures";

test("POST /api/flows/[id]/chat returns 401 when unauthenticated", async () => {
  const { createFlowAssistantChatPostHandler } =
    await loadFlowAssistantChatRoute();
  let streamCalls = 0;
  let limitCalls = 0;
  const handler = createFlowAssistantChatPostHandler({
    requireUserId: (async () => new Response(null, { status: 401 })) as never,
    streamFlowAssistantChat: (async () => {
      streamCalls += 1;
      return new Response("ok");
    }) as never,
    enforceChatLimits: (async () => {
      limitCalls += 1;
      return { allowed: true, claimId: "claim-1" };
    }) as never,
    recordLimitDecision: noopRecord,
    releaseLimitClaim: noopRelease,
  });

  const response = await handler(makeRequest({}), { params });
  assert.equal(response.status, 401);
  assert.equal(streamCalls, 0);
  assert.equal(limitCalls, 0);
});

test("POST /api/flows/[id]/chat requires messages", async () => {
  const { createFlowAssistantChatPostHandler } =
    await loadFlowAssistantChatRoute();
  let streamCalls = 0;
  let limitCalls = 0;
  const handler = createFlowAssistantChatPostHandler({
    requireUserId: async () => "user-1",
    streamFlowAssistantChat: (async () => {
      streamCalls += 1;
      return new Response("ok");
    }) as never,
    enforceChatLimits: (async () => {
      limitCalls += 1;
      return { allowed: true, claimId: "claim-1" };
    }) as never,
    recordLimitDecision: noopRecord,
    releaseLimitClaim: noopRelease,
  });

  const response = await handler(
    makeRequest({ graph: { nodes: [], edges: [] } }),
    { params }
  );

  assert.equal(response.status, 400);
  assert.equal(streamCalls, 0);
  // Malformed requests must not burn quota: the rate-limit check sits behind
  // body validation by design - pin that invariant.
  assert.equal(limitCalls, 0);
});

test("POST /api/flows/[id]/chat accepts messages without request-body graph", async () => {
  const { createFlowAssistantChatPostHandler } =
    await loadFlowAssistantChatRoute();
  let streamCalls = 0;
  const handler = createFlowAssistantChatPostHandler({
    requireUserId: async () => "user-1",
    streamFlowAssistantChat: (async () => {
      streamCalls += 1;
      return new Response("ok");
    }) as never,
    enforceChatLimits: (async () => ({
      allowed: true,
      claimId: "claim-1",
    })) as never,
    recordLimitDecision: noopRecord,
    releaseLimitClaim: noopRelease,
  });

  const response = await handler(makeRequest({ messages: [] }), { params });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "ok");
  assert.equal(streamCalls, 1);
});

test("extractLatestFlowAssistantGraphState reads latest client graph tool output", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  const { extractLatestFlowAssistantGraphState } =
    await import("@/lib/flows/api");
  const graph = {
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };

  const extracted = extractLatestFlowAssistantGraphState([
    {
      id: "assistant-1",
      role: "assistant",
      parts: [
        {
          type: "tool-getGraphState",
          toolCallId: "tool-1",
          state: "output-available",
          input: {},
          output: { graph },
        },
      ],
    },
  ] as never);

  assert.deepEqual(extracted, graph);
});

test("POST /api/flows/[id]/chat forwards the active team header", async () => {
  const { createFlowAssistantChatPostHandler } =
    await loadFlowAssistantChatRoute();
  const calls: Array<{
    userId: string;
    flowId: string;
    teamId?: string | null;
    capabilities?: string[];
  }> = [];
  const capabilities = new Set(["models.*"]);
  const { markReleased, released } = createReleaseProbe();
  const handler = createFlowAssistantChatPostHandler({
    requireUserId: async () => "user-1",
    streamFlowAssistantChat: (async (input: {
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
      return new Response("streamed", { status: 200 });
    }) as never,
    resolveActiveTeamCapabilities: async (_userId, teamId) => ({
      ok: true,
      teamId: teamId ?? null,
      capabilities,
    }),
    enforceChatLimits: allowLimits,
    releaseLimitClaim: (async () => {
      markReleased();
      return true;
    }) as never,
    recordLimitDecision: noopRecord,
  });

  const response = await handler(
    makeRequest(
      {
        messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }],
      },
      { "x-mogplex-team-id": " 00000000-0000-4000-8000-000000000001 " }
    ),
    { params }
  );

  assert.equal(response.status, 200);
  assert.equal(await response.text(), "streamed");
  await released;
  assert.deepEqual(calls, [
    {
      userId: "user-1",
      flowId: "flow-1",
      teamId: "00000000-0000-4000-8000-000000000001",
      capabilities: ["models.*"],
    },
  ]);
});

test("POST /api/flows/[id]/chat rejects invalid active team before metering", async () => {
  const { createFlowAssistantChatPostHandler } =
    await loadFlowAssistantChatRoute();
  let streamCalls = 0;
  let limitCalls = 0;
  const handler = createFlowAssistantChatPostHandler({
    requireUserId: async () => "user-1",
    streamFlowAssistantChat: (async () => {
      streamCalls += 1;
      return new Response("streamed", { status: 200 });
    }) as never,
    resolveActiveTeamCapabilities: async () => ({
      ok: false,
      status: 403,
      error: "Forbidden",
    }),
    enforceChatLimits: (async () => {
      limitCalls += 1;
      return { allowed: true, claimId: "claim-1" };
    }) as never,
    releaseLimitClaim: noopRelease,
    recordLimitDecision: noopRecord,
  });

  const response = await handler(
    makeRequest(
      {
        messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }],
      },
      { "x-mogplex-team-id": "00000000-0000-4000-8000-000000000001" }
    ),
    { params }
  );

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "Forbidden" });
  assert.equal(streamCalls, 0);
  assert.equal(limitCalls, 0);
});
