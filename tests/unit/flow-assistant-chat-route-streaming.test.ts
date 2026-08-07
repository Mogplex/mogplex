import assert from "node:assert/strict";
import test from "node:test";
import {
  loadFlowAssistantChatRoute,
  makeRequest,
  params,
  allowLimits,
  noopRecord,
  createReleaseProbe,
} from "./helpers/flow-assistant-chat-route-fixtures";

test("POST /api/flows/[id]/chat streams when authorized and releases on body close", async () => {
  const { createFlowAssistantChatPostHandler } =
    await loadFlowAssistantChatRoute();
  const calls: Array<{ userId: string; flowId: string }> = [];
  const limitCalls: Array<{ userId: string }> = [];
  const releaseCalls: Array<{ userId: string; claimId: string }> = [];
  const recordCalls: Array<{ userId: string; resourceId?: string | null }> = [];
  const { markReleased, released } = createReleaseProbe();
  const handler = createFlowAssistantChatPostHandler({
    requireUserId: async () => "user-1",
    streamFlowAssistantChat: (async (input: {
      userId: string;
      flowId: string;
    }) => {
      calls.push({ userId: input.userId, flowId: input.flowId });
      return new Response("streamed", { status: 200 });
    }) as never,
    enforceChatLimits: (async (input: { userId: string }) => {
      limitCalls.push({ userId: input.userId });
      return { allowed: true, claimId: "claim-1" };
    }) as never,
    releaseLimitClaim: (async (input: { userId: string; claimId: string }) => {
      releaseCalls.push({ userId: input.userId, claimId: input.claimId });
      return true;
    }) as never,
    recordLimitDecision: (async (input: {
      userId: string;
      resourceId?: string | null;
    }) => {
      recordCalls.push({ userId: input.userId, resourceId: input.resourceId });
      // Signal after metering, not after release, so the assertions below
      // observe the required release-before-record ordering.
      markReleased();
    }) as never,
  });

  const response = await handler(
    makeRequest({
      messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }],
    }),
    { params }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(limitCalls, [{ userId: "user-1" }]);
  assert.deepEqual(calls, [{ userId: "user-1", flowId: "flow-1" }]);
  // The claim is intentionally NOT released at dispatch - that would collapse
  // the concurrency window to ~zero ms and bypass the gate.
  assert.equal(releaseCalls.length, 0);
  assert.equal(recordCalls.length, 0);
  // Once the client drains the body, the passthrough pipe closes and fires the
  // release, then leaves a claim-less durable event for hourly/daily metering.
  assert.equal(await response.text(), "streamed");
  await released;
  assert.deepEqual(releaseCalls, [{ userId: "user-1", claimId: "claim-1" }]);
  assert.deepEqual(recordCalls, [{ userId: "user-1", resourceId: "flow-1" }]);
});

test("POST /api/flows/[id]/chat does not meter accepted starts when claim release fails", async () => {
  const { createFlowAssistantChatPostHandler } =
    await loadFlowAssistantChatRoute();
  let recordCalls = 0;
  const { markReleased, released } = createReleaseProbe();
  const handler = createFlowAssistantChatPostHandler({
    requireUserId: async () => "user-1",
    streamFlowAssistantChat: (async () => new Response("streamed")) as never,
    enforceChatLimits: allowLimits,
    releaseLimitClaim: (async () => {
      markReleased();
      return false;
    }) as never,
    recordLimitDecision: (async () => {
      recordCalls += 1;
    }) as never,
  });

  const response = await handler(
    makeRequest({
      messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }],
      graph: { nodes: [], edges: [] },
    }),
    { params }
  );

  assert.equal(response.status, 200);
  assert.equal(await response.text(), "streamed");
  await released;
  assert.equal(recordCalls, 0);
});

test("POST /api/flows/[id]/chat releases the claim when the client cancels the stream", async () => {
  const { createFlowAssistantChatPostHandler } =
    await loadFlowAssistantChatRoute();
  const releaseCalls: Array<{ claimId: string }> = [];
  let recordCalls = 0;
  const { markReleased, released } = createReleaseProbe();
  const handler = createFlowAssistantChatPostHandler({
    requireUserId: async () => "user-1",
    streamFlowAssistantChat: (async () => {
      // A stream that never ends on its own - only client cancel will close it.
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("chunk"));
        },
      });
      return new Response(body, { status: 200 });
    }) as never,
    enforceChatLimits: allowLimits,
    releaseLimitClaim: (async (input: { claimId: string }) => {
      releaseCalls.push({ claimId: input.claimId });
      markReleased();
      return true;
    }) as never,
    recordLimitDecision: (async () => {
      recordCalls += 1;
    }) as never,
  });

  const response = await handler(
    makeRequest({
      messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }],
      graph: { nodes: [], edges: [] },
    }),
    { params }
  );

  assert.equal(response.status, 200);
  assert.equal(releaseCalls.length, 0);
  await response.body!.cancel("client-disconnected");
  await released;
  assert.deepEqual(releaseCalls, [{ claimId: "claim-1" }]);
  assert.equal(recordCalls, 0);
});

test("POST /api/flows/[id]/chat releases the claim when the stream errors mid-read", async () => {
  const { createFlowAssistantChatPostHandler } =
    await loadFlowAssistantChatRoute();
  const releaseCalls: Array<{ claimId: string }> = [];
  let recordCalls = 0;
  const { markReleased, released } = createReleaseProbe();
  const handler = createFlowAssistantChatPostHandler({
    requireUserId: async () => "user-1",
    streamFlowAssistantChat: (async () => {
      // Enqueue one chunk, then error the underlying stream. The passthrough
      // pipe must still release the claim when it observes the source error.
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("chunk"));
          controller.error(new Error("upstream model exploded"));
        },
      });
      return new Response(body, { status: 200 });
    }) as never,
    enforceChatLimits: allowLimits,
    releaseLimitClaim: (async (input: { claimId: string }) => {
      releaseCalls.push({ claimId: input.claimId });
      markReleased();
      return true;
    }) as never,
    recordLimitDecision: (async () => {
      recordCalls += 1;
    }) as never,
  });

  const response = await handler(
    makeRequest({
      messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }],
      graph: { nodes: [], edges: [] },
    }),
    { params }
  );

  assert.equal(response.status, 200);
  // Drain the wrapped stream - the passthrough pipe surfaces the upstream
  // error to the consumer and still releases the claim.
  const reader = response.body!.getReader();
  let threw = false;
  try {
    // Drain until we hit the error.
    for (;;) {
      const { done } = await reader.read();
      if (done) break;
    }
  } catch {
    threw = true;
  }
  await released;
  assert.equal(threw, true);
  assert.deepEqual(releaseCalls, [{ claimId: "claim-1" }]);
  assert.equal(recordCalls, 0);
});

test("POST /api/flows/[id]/chat surfaces stream errors", async () => {
  const { createFlowAssistantChatPostHandler } =
    await loadFlowAssistantChatRoute();
  const releaseCalls: Array<{ claimId: string }> = [];
  let recordCalls = 0;
  const handler = createFlowAssistantChatPostHandler({
    requireUserId: async () => "user-1",
    streamFlowAssistantChat: (async () => {
      throw new Error("model unavailable");
    }) as never,
    enforceChatLimits: allowLimits,
    recordLimitDecision: (async () => {
      recordCalls += 1;
    }) as never,
    releaseLimitClaim: (async (input: { claimId: string }) => {
      releaseCalls.push({ claimId: input.claimId });
      return true;
    }) as never,
  });

  const response = await handler(
    makeRequest({
      messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }],
      graph: { nodes: [], edges: [] },
    }),
    { params }
  );

  assert.equal(response.status, 500);
  const payload = (await response.json()) as { error?: string };
  assert.equal(payload.error, "Failed to start flow assistant chat");
  // Failed starts must refund the claim too.
  assert.deepEqual(releaseCalls, [{ claimId: "claim-1" }]);
  assert.equal(recordCalls, 0);
});

test("POST /api/flows/[id]/chat returns 429 when rate limited", async () => {
  const { createFlowAssistantChatPostHandler } =
    await loadFlowAssistantChatRoute();
  let streamCalls = 0;
  let releaseCalls = 0;
  const handler = createFlowAssistantChatPostHandler({
    requireUserId: async () => "user-1",
    streamFlowAssistantChat: (async () => {
      streamCalls += 1;
      return new Response("ok");
    }) as never,
    enforceChatLimits: (async () => ({
      allowed: false,
      status: 429,
      code: "chat_rate_limited",
      error: "Too many requests",
      reason: "chat_starts_per_hour",
      retryAfterSeconds: 42,
      limit: { name: "chat_starts_per_hour", value: 30, windowSeconds: 3600 },
    })) as never,
    releaseLimitClaim: (async () => {
      releaseCalls += 1;
      return true;
    }) as never,
    recordLimitDecision: noopRecord,
  });

  const response = await handler(
    makeRequest({
      messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }],
      graph: { nodes: [], edges: [] },
    }),
    { params }
  );

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "42");
  const payload = (await response.json()) as {
    code?: string;
    error?: string;
    retryAfterSeconds?: number;
    limit?: { name?: string };
  };
  assert.equal(payload.error, "Too many requests");
  assert.equal(payload.code, "chat_rate_limited");
  assert.equal(payload.retryAfterSeconds, 42);
  assert.equal(payload.limit?.name, "chat_starts_per_hour");
  assert.equal(streamCalls, 0);
  // Denied admissions never produced a claim - nothing to refund.
  assert.equal(
    releaseCalls,
    0,
    "denied admissions must not release a missing claim"
  );
});

test("POST /api/flows/[id]/chat returns a structured error when limit enforcement fails", async () => {
  const { createFlowAssistantChatPostHandler } =
    await loadFlowAssistantChatRoute();
  let streamCalls = 0;
  let releaseCalls = 0;
  const handler = createFlowAssistantChatPostHandler({
    requireUserId: async () => "user-1",
    streamFlowAssistantChat: (async () => {
      streamCalls += 1;
      return new Response("ok");
    }) as never,
    enforceChatLimits: (async () => {
      throw new Error("DB unavailable");
    }) as never,
    releaseLimitClaim: (async () => {
      releaseCalls += 1;
      return true;
    }) as never,
    recordLimitDecision: noopRecord,
  });

  const response = await handler(
    makeRequest({
      messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }],
      graph: { nodes: [], edges: [] },
    }),
    { params }
  );

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Retry-After"), "15");
  assert.deepEqual(await response.json(), {
    error: "Unable to check chat limits",
    code: "chat_limit_check_failed",
    retryAfterSeconds: 15,
  });
  assert.equal(streamCalls, 0);
  // No admission claim was created, so there is nothing to release.
  assert.equal(
    releaseCalls,
    0,
    "limit-check failures must not release a missing claim"
  );
});

test("POST /api/flows/[id]/chat fails loudly when an allowed limit decision has no claim", async () => {
  const { createFlowAssistantChatPostHandler } =
    await loadFlowAssistantChatRoute();
  let streamCalls = 0;
  let releaseCalls = 0;
  const handler = createFlowAssistantChatPostHandler({
    requireUserId: async () => "user-1",
    streamFlowAssistantChat: (async () => {
      streamCalls += 1;
      return new Response("ok");
    }) as never,
    enforceChatLimits: (async () => ({ allowed: true })) as never,
    releaseLimitClaim: (async () => {
      releaseCalls += 1;
      return true;
    }) as never,
    recordLimitDecision: noopRecord,
  });

  const response = await handler(
    makeRequest({
      messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }],
      graph: { nodes: [], edges: [] },
    }),
    { params }
  );

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: "Unable to start flow assistant chat",
    code: "chat_limit_claim_missing",
  });
  assert.equal(streamCalls, 0);
  assert.equal(releaseCalls, 0);
});
