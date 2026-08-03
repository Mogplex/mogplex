import assert from "node:assert/strict";
import test from "node:test";
import type { ListenerHandle } from "../../app/api/realtime/events/route";

type TableEventPayload = {
  table: string;
  op: string;
  user_id?: string | null;
  id?: string | null;
};

type MockListenerHandle = ListenerHandle & {
  emit: (payload: TableEventPayload) => void;
};

function createMockListener(): MockListenerHandle {
  let handler: ((payload: TableEventPayload) => void) | undefined;
  return {
    onNotification: (h) => {
      handler = h;
    },
    end: async () => {
      // noop
    },
    emit: (payload) => {
      if (handler) handler(payload);
    },
  };
}

async function loadRealtimeEventsRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  process.env.DATABASE_URL_UNPOOLED ||= "postgres://test:test@localhost/test";
  return import("../../app/api/realtime/events/route");
}

test("GET /api/realtime/events returns 401 without auth", async () => {
  const { createRealtimeEventsGetHandler } = await loadRealtimeEventsRoute();

  const handler = createRealtimeEventsGetHandler({
    getResolvedAuth: async () => undefined,
    createListener: async () => createMockListener(),
  });

  const response = await handler(
    new Request("http://localhost/api/realtime/events?tables=repos")
  );

  assert.equal(response.status, 401);
  const payload = await response.json();
  assert.equal(payload.error, "Unauthorized");
});

test("GET /api/realtime/events returns 400 without tables param", async () => {
  const { createRealtimeEventsGetHandler } = await loadRealtimeEventsRoute();

  const handler = createRealtimeEventsGetHandler({
    getResolvedAuth: async () => ({
      profileId: "user-123",
      authUserId: null,
      source: "playwright" as const,
    }),
    createListener: async () => createMockListener(),
  });

  const response = await handler(
    new Request("http://localhost/api/realtime/events")
  );

  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.error, "Missing tables parameter");
});

test("GET /api/realtime/events returns 400 for invalid table name", async () => {
  const { createRealtimeEventsGetHandler } = await loadRealtimeEventsRoute();

  const handler = createRealtimeEventsGetHandler({
    getResolvedAuth: async () => ({
      profileId: "user-123",
      authUserId: null,
      source: "playwright" as const,
    }),
    createListener: async () => createMockListener(),
  });

  const response = await handler(
    new Request(
      "http://localhost/api/realtime/events?tables=repos,invalid-name"
    )
  );

  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.error, "Invalid table name: invalid-name");
});

test("GET /api/realtime/events returns 400 for SQL injection attempt", async () => {
  const { createRealtimeEventsGetHandler } = await loadRealtimeEventsRoute();

  const handler = createRealtimeEventsGetHandler({
    getResolvedAuth: async () => ({
      profileId: "user-123",
      authUserId: null,
      source: "playwright" as const,
    }),
    createListener: async () => createMockListener(),
  });

  const response = await handler(
    new Request(
      "http://localhost/api/realtime/events?tables=repos;DROP TABLE users"
    )
  );

  assert.equal(response.status, 400);
});

test("GET /api/realtime/events streams matching events for user", async () => {
  const { createRealtimeEventsGetHandler } = await loadRealtimeEventsRoute();

  const mockListener = createMockListener();
  let listenerCreated = false;

  const handler = createRealtimeEventsGetHandler({
    getResolvedAuth: async () => ({
      profileId: "user-123",
      authUserId: null,
      source: "playwright" as const,
    }),
    createListener: async () => {
      listenerCreated = true;
      return mockListener;
    },
  });

  const abortController = new AbortController();
  const request = new Request(
    "http://localhost/api/realtime/events?tables=repos,sandboxes",
    { signal: abortController.signal }
  );

  const response = await handler(request);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "text/event-stream");
  assert.equal(listenerCreated, true);

  // Read the stream
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();

  // Read initial connection message
  const { value: connValue } = await reader.read();
  const connMessage = decoder.decode(connValue);
  assert.ok(
    connMessage.includes(": connected"),
    "Should receive connection confirmation"
  );

  // Emit events and verify filtering
  const receivedEvents: string[] = [];

  // Read events in a background task
  const readPromise = (async () => {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const text = decoder.decode(value);
      // Filter out ping comments
      if (!text.startsWith(": ping")) {
        receivedEvents.push(text);
      }
      // Stop after receiving 2 events
      if (receivedEvents.length >= 2) {
        abortController.abort();
        break;
      }
    }
  })();

  // Give it a moment to set up
  await new Promise((r) => setTimeout(r, 10));

  // Event 1: matching table and user
  mockListener.emit({
    table: "repos",
    op: "INSERT",
    user_id: "user-123",
    id: "repo-1",
  });

  // Event 2: different user (should be filtered out)
  mockListener.emit({
    table: "repos",
    op: "UPDATE",
    user_id: "user-other",
    id: "repo-2",
  });

  // Event 3: different table (should be filtered out)
  mockListener.emit({
    table: "agents",
    op: "INSERT",
    user_id: "user-123",
    id: "agent-1",
  });

  // Event 4: broadcast event (null user_id, should pass through)
  mockListener.emit({
    table: "sandboxes",
    op: "DELETE",
    user_id: null,
    id: "sandbox-1",
  });

  // Wait for reading to complete
  await readPromise.catch(() => {
    // Abort error is expected
  });

  // Should have received 2 events: repos INSERT for user-123 and sandboxes DELETE (broadcast)
  assert.equal(receivedEvents.length, 2);
  assert.ok(
    receivedEvents[0].includes('"table":"repos"'),
    "First event should be for repos table"
  );
  assert.ok(
    receivedEvents[0].includes('"op":"INSERT"'),
    "First event should be INSERT"
  );
  assert.ok(
    receivedEvents[1].includes('"table":"sandboxes"'),
    "Second event should be for sandboxes table"
  );
});

test("GET /api/realtime/events filters events by table allowlist", async () => {
  const { createRealtimeEventsGetHandler } = await loadRealtimeEventsRoute();

  const mockListener = createMockListener();

  const handler = createRealtimeEventsGetHandler({
    getResolvedAuth: async () => ({
      profileId: "user-123",
      authUserId: null,
      source: "playwright" as const,
    }),
    createListener: async () => mockListener,
  });

  const abortController = new AbortController();
  const request = new Request(
    "http://localhost/api/realtime/events?tables=repos",
    { signal: abortController.signal }
  );

  const response = await handler(request);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();

  // Skip connection message
  await reader.read();

  const receivedEvents: string[] = [];

  const readPromise = (async () => {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const text = decoder.decode(value);
      if (!text.startsWith(": ping")) {
        receivedEvents.push(text);
      }
      if (receivedEvents.length > 0) {
        abortController.abort();
        break;
      }
    }
  })();

  await new Promise((r) => setTimeout(r, 10));

  // Event for non-subscribed table (should be filtered)
  mockListener.emit({
    table: "sandboxes",
    op: "INSERT",
    user_id: "user-123",
    id: "sandbox-1",
  });

  // Event for subscribed table (should pass through)
  mockListener.emit({
    table: "repos",
    op: "UPDATE",
    user_id: "user-123",
    id: "repo-1",
  });

  await readPromise.catch(() => {
    // Abort error is expected
  });

  // Only repos event should be received
  assert.equal(receivedEvents.length, 1);
  assert.ok(receivedEvents[0].includes('"table":"repos"'));
});
