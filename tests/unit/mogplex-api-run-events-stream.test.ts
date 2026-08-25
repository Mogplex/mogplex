import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import type {
  TableEventListener,
  TableEventPayload,
} from "../../lib/db/table-event-listener";
import { presentMogplexApiRun } from "../../lib/mogplex-api/runs";
import { buildRunRow } from "./helpers/mogplex-api-runs-fixtures";

type MockListener = TableEventListener & {
  emit: (payload: TableEventPayload) => void;
};

function createMockListener(onEnd?: () => void): MockListener {
  let notificationHandler: ((payload: TableEventPayload) => void) | undefined;
  return {
    onNotification: (handler) => {
      notificationHandler = handler;
    },
    onError: () => {},
    end: async () => onEnd?.(),
    emit: (payload) => notificationHandler?.(payload),
  };
}

async function loadRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  process.env.DATABASE_URL_UNPOOLED ||= "postgres://test:test@localhost/test";
  return import("../../app/api/v1/mogplex/runs/[runId]/events/stream/route");
}

test("run event stream replays durable events and follows owned notifications", async () => {
  const { createMogplexApiRunEventsStreamGetHandler } = await loadRoute();
  let ended = 0;
  const listener = createMockListener(() => (ended += 1));
  const run = presentMogplexApiRun(buildRunRow());
  const handler = createMogplexApiRunEventsStreamGetHandler({
    resolveApiKey: async () => ({
      ok: true,
      auth: { userId: "user-123", keyId: "key-1", scopes: ["read"] },
    }),
    listEvents: async () => ({
      run,
      events: [
        {
          id: "event-1",
          type: "started",
          toolName: null,
          message: "Run started",
          payload: {},
          createdAt: "2026-08-25T12:00:00.000Z",
        },
      ],
    }),
    loadEvent: async (input) => {
      assert.deepEqual(input, {
        userId: "user-123",
        runId: "run-1",
        eventId: "event-2",
      });
      return {
        id: "event-2",
        type: "log",
        toolName: null,
        message: "Working",
        payload: { kind: "assistant_delta" },
        createdAt: "2026-08-25T12:00:01.000Z",
      };
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
    user_id: "another-user",
    id: "ignored",
  });
  listener.emit({
    table: "ai_call_events",
    op: "INSERT",
    user_id: "user-123",
    id: "event-2",
  });

  const live = decoder.decode((await reader.read()).value);
  assert.match(live, /id: event-2\n/);
  assert.match(live, /"message":"Working"/);
  await reader.cancel();
  assert.equal(ended, 1);
});

test("run event stream closes after a terminal event", async () => {
  const { createMogplexApiRunEventsStreamGetHandler } = await loadRoute();
  const listener = createMockListener();
  const handler = createMogplexApiRunEventsStreamGetHandler({
    resolveApiKey: async () => ({
      ok: true,
      auth: { userId: "user-123", keyId: "key-1", scopes: ["read"] },
    }),
    listEvents: async () => ({
      run: presentMogplexApiRun(buildRunRow({ status: "success" })),
      events: [
        {
          id: "event-finished",
          type: "finished",
          toolName: null,
          message: "Harness run finished",
          payload: {},
          createdAt: "2026-08-25T12:00:01.000Z",
        },
      ],
    }),
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
