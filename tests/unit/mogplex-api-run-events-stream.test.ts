import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import type {
  TableEventListener,
  TableEventPayload,
} from "../../lib/db/table-event-listener";
import type { PresentedAiCallEvent } from "../../lib/mogplex-api/run-control";
import type { MogplexApiRunEventCursor } from "../../lib/mogplex-api/run-event";
import { presentMogplexApiRun } from "../../lib/mogplex-api/runs";
import { buildRunRow } from "./helpers/mogplex-api-runs-fixtures";

type MockListener = TableEventListener & {
  emit: (payload: TableEventPayload) => void;
  emitError: (error: Error) => void;
};

function createMockListener(onEnd?: () => void): MockListener {
  let notificationHandler: ((payload: TableEventPayload) => void) | undefined;
  let errorHandler: ((error: Error) => void) | undefined;
  return {
    onNotification: (handler) => {
      notificationHandler = handler;
    },
    onError: (handler) => {
      errorHandler = handler;
    },
    end: async () => onEnd?.(),
    emit: (payload) => notificationHandler?.(payload),
    emitError: (error) => errorHandler?.(error),
  };
}

async function loadRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  process.env.DATABASE_URL_UNPOOLED ||= "postgres://test:test@localhost/test";
  return import("../../app/api/v1/mogplex/runs/[runId]/events/stream/route");
}

function event(
  id: string,
  type: PresentedAiCallEvent["type"] = "log"
): PresentedAiCallEvent {
  return {
    id,
    type,
    toolName: null,
    message: type === "log" ? `message ${id}` : "Harness run finished",
    payload: type === "log" ? { kind: "assistant_delta" } : {},
    createdAt: `2026-08-25T12:00:0${id.at(-1) ?? "0"}.000Z`,
  };
}

function cursor(value: PresentedAiCallEvent): MogplexApiRunEventCursor {
  return { id: value.id, createdAt: value.createdAt };
}

function page(events: PresentedAiCallEvent[], hasMore = false) {
  return {
    events,
    cursor: events.at(-1) ? cursor(events.at(-1)!) : null,
    hasMore,
  };
}

function auth() {
  return {
    ok: true as const,
    auth: { userId: "user-123", keyId: "key-1", scopes: ["read"] },
  };
}

test("run event stream replays durable events and follows owned notifications", async () => {
  const { createMogplexApiRunEventsStreamGetHandler } = await loadRoute();
  let ended = 0;
  const listener = createMockListener(() => (ended += 1));
  const run = presentMogplexApiRun(buildRunRow());
  const handler = createMogplexApiRunEventsStreamGetHandler({
    resolveApiKey: async () => auth(),
    loadContext: async () => ({ run, aiCallId: run.aiCallId, cursor: null }),
    listPage: async (input) => {
      assert.equal(input.latest, true);
      return page([event("event-1")]);
    },
    loadEvent: async (input) => {
      assert.deepEqual(input, {
        userId: "user-123",
        aiCallId: run.aiCallId,
        eventId: "event-2",
      });
      return event("event-2");
    },
    createListener: async () => listener,
  });

  const response = await handler(
    new NextRequest(
      "http://localhost/api/v1/mogplex/runs/run-1/events/stream",
      { headers: { authorization: "Bearer mog_valid" } }
    ),
    { params: Promise.resolve({ runId: "run-1" }) }
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/event-stream");
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  assert.equal(decoder.decode((await reader.read()).value), ": connected\n\n");
  assert.match(decoder.decode((await reader.read()).value), /event: run\n/);
  assert.match(decoder.decode((await reader.read()).value), /id: event-1\n/);

  listener.emit({
    table: "ai_call_events",
    op: "INSERT",
    user_id: "user-123",
    ai_call_id: "another-call",
    id: "ignored-other-run",
  });
  listener.emit({
    table: "ai_call_events",
    op: "INSERT",
    user_id: "user-123",
    ai_call_id: run.aiCallId,
    id: "event-2",
  });

  const live = decoder.decode((await reader.read()).value);
  assert.match(live, /id: event-2\n/);
  assert.match(live, /"message":"message event-2"/);
  await reader.cancel();
  assert.equal(ended, 1);
});

test("run event stream resumes every durable page after Last-Event-ID", async () => {
  const { createMogplexApiRunEventsStreamGetHandler } = await loadRoute();
  const listener = createMockListener();
  const run = presentMogplexApiRun(buildRunRow());
  const resumeCursor = cursor(event("event-0"));
  const calls: Array<MogplexApiRunEventCursor | null> = [];
  const handler = createMogplexApiRunEventsStreamGetHandler({
    resolveApiKey: async () => auth(),
    loadContext: async (input) => {
      assert.equal(input.lastEventId, "event-0");
      return { run, aiCallId: run.aiCallId, cursor: resumeCursor };
    },
    listPage: async (input) => {
      assert.equal(input.latest, false);
      calls.push(input.cursor);
      return input.cursor?.id === "event-0"
        ? page([event("event-1")], true)
        : page([event("event-2")]);
    },
    loadEvent: async () => null,
    createListener: async () => listener,
  });

  const response = await handler(
    new NextRequest(
      "http://localhost/api/v1/mogplex/runs/run-1/events/stream",
      {
        headers: {
          authorization: "Bearer mog_valid",
          "last-event-id": "event-0",
        },
      }
    ),
    { params: Promise.resolve({ runId: "run-1" }) }
  );
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  await reader.read();
  await reader.read();
  assert.match(decoder.decode((await reader.read()).value), /id: event-1\n/);
  assert.match(decoder.decode((await reader.read()).value), /id: event-2\n/);
  assert.deepEqual(
    calls.map((value) => value?.id),
    ["event-0", "event-1"]
  );
  await reader.cancel();
});

test("run event stream drains a notification arriving during its idle handoff", async () => {
  const { createMogplexApiRunEventsStreamGetHandler } = await loadRoute();
  const listener = createMockListener();
  const run = presentMogplexApiRun(buildRunRow());
  let handedOff = false;
  const handler = createMogplexApiRunEventsStreamGetHandler({
    resolveApiKey: async () => auth(),
    loadContext: async () => ({ run, aiCallId: run.aiCallId, cursor: null }),
    listPage: async () => page([]),
    loadEvent: async () => null,
    loadPendingEvent: async ({ pendingIds }) => {
      const eventId = pendingIds.shift();
      if (!eventId && !handedOff) {
        handedOff = true;
        listener.emit({
          table: "ai_call_events",
          op: "INSERT",
          user_id: "user-123",
          ai_call_id: run.aiCallId,
          id: "event-2",
        });
        return null;
      }
      return eventId ? event(eventId) : null;
    },
    createListener: async () => listener,
  });

  const response = await handler(
    new NextRequest(
      "http://localhost/api/v1/mogplex/runs/run-1/events/stream",
      { headers: { authorization: "Bearer mog_valid" } }
    ),
    { params: Promise.resolve({ runId: "run-1" }) }
  );
  const reader = response.body!.getReader();
  await reader.read();
  await reader.read();
  assert.match(
    new TextDecoder().decode((await reader.read()).value),
    /id: event-2\n/
  );
  assert.equal(handedOff, true);
  await reader.cancel();
});

test("run event stream closes after a terminal event", async () => {
  const { createMogplexApiRunEventsStreamGetHandler } = await loadRoute();
  const listener = createMockListener();
  const run = presentMogplexApiRun(buildRunRow({ status: "success" }));
  const handler = createMogplexApiRunEventsStreamGetHandler({
    resolveApiKey: async () => auth(),
    loadContext: async () => ({ run, aiCallId: run.aiCallId, cursor: null }),
    listPage: async () => page([event("event-1", "finished")]),
    loadEvent: async () => null,
    createListener: async () => listener,
  });

  const response = await handler(
    new NextRequest(
      "http://localhost/api/v1/mogplex/runs/run-1/events/stream",
      { headers: { authorization: "Bearer mog_valid" } }
    ),
    { params: Promise.resolve({ runId: "run-1" }) }
  );
  const reader = response.body!.getReader();
  await reader.read();
  await reader.read();
  assert.match(
    new TextDecoder().decode((await reader.read()).value),
    /event: finished/
  );
  assert.equal((await reader.read()).done, true);
});

test("run event stream closes when the listener fails during an event lookup", async () => {
  const { createMogplexApiRunEventsStreamGetHandler } = await loadRoute();
  const listener = createMockListener();
  const run = presentMogplexApiRun(buildRunRow());
  let releaseLookup!: () => void;
  const lookupBlocked = new Promise<void>((resolve) => {
    releaseLookup = resolve;
  });
  let lookupStarted!: () => void;
  const lookupPending = new Promise<void>((resolve) => {
    lookupStarted = resolve;
  });
  const consoleError = console.error;
  console.error = () => undefined;
  const handler = createMogplexApiRunEventsStreamGetHandler({
    resolveApiKey: async () => auth(),
    loadContext: async () => ({ run, aiCallId: run.aiCallId, cursor: null }),
    listPage: async () => page([]),
    loadEvent: async () => {
      lookupStarted();
      await lookupBlocked;
      return null;
    },
    createListener: async () => listener,
  });

  try {
    const response = await handler(
      new NextRequest(
        "http://localhost/api/v1/mogplex/runs/run-1/events/stream",
        { headers: { authorization: "Bearer mog_valid" } }
      ),
      { params: Promise.resolve({ runId: "run-1" }) }
    );
    const reader = response.body!.getReader();
    await reader.read();
    await reader.read();
    listener.emit({
      table: "ai_call_events",
      op: "INSERT",
      user_id: "user-123",
      ai_call_id: run.aiCallId,
      id: "event-pending",
    });
    await lookupPending;
    listener.emitError(new Error("listener disconnected"));
    releaseLookup();

    const closed = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("stream stayed open after listener failure")),
          250
        )
      ),
    ]);
    assert.equal(closed.done, true);
  } finally {
    console.error = consoleError;
  }
});
