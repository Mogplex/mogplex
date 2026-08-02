import assert from "node:assert/strict";
import test from "node:test";
import { defaultSandboxAuth } from "./sandbox-record-route-test-harness/shared";
import {
  buildSandboxRouteParams,
  buildSandboxRouteRequest,
} from "./sandbox-record-route-test-harness";

async function loadPresenceRouteModule() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/sandbox/[id]/presence/route");
}

function buildPresenceRequest(
  event: "attach" | "release",
  overrides: Partial<{
    tabId: string;
    sessionId: string;
    eventSeq: number;
    reason: string;
  }> = {}
) {
  return buildSandboxRouteRequest({
    method: "POST",
    suffix: "/presence",
    init: {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event,
        tabId: overrides.tabId ?? "tab-1",
        sessionId: overrides.sessionId ?? "session-1",
        eventSeq: overrides.eventSeq ?? (event === "attach" ? 1 : 2),
        reason:
          event === "release" ? (overrides.reason ?? "pagehide") : undefined,
      }),
    },
  });
}

function buildLoadedPresenceRecord() {
  return {
    ok: true as const,
    auth: { ...defaultSandboxAuth, userId: "user-1" },
    repo: null,
    rootDirectory: undefined,
    record: {
      id: "sandbox-record-1",
      user_id: "user-1",
      sandbox_id: "vm_123",
    },
  };
}

test("POST /api/sandbox/[id]/presence records attach events", async () => {
  const { createSandboxPresenceHandler } = await loadPresenceRouteModule();
  const attached: unknown[] = [];

  const handler = createSandboxPresenceHandler({
    loadOwnedSandboxRouteRecord: (async () =>
      buildLoadedPresenceRecord()) as never,
    recordSandboxClientAttach: async (input) => {
      attached.push(input);
    },
    recordSandboxClientRelease: async () => ({
      released: false,
      shouldQueue: false,
    }),
    queueSandboxAutoPauseCheck: async () => {
      throw new Error("attach should not queue auto-pause");
    },
  });

  const response = await handler(
    buildPresenceRequest("attach"),
    buildSandboxRouteParams("sandbox-record-1")
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { attached: true });
  assert.deepEqual(attached, [
    {
      sandboxRecordId: "sandbox-record-1",
      sandboxId: "vm_123",
      userId: "user-1",
      tabId: "tab-1",
      sessionId: "session-1",
      eventSeq: 1,
    },
  ]);
});

test("POST /api/sandbox/[id]/presence queues auto-pause after a real release", async () => {
  const { createSandboxPresenceHandler } = await loadPresenceRouteModule();
  const queued: unknown[] = [];

  const handler = createSandboxPresenceHandler({
    loadOwnedSandboxRouteRecord: (async () =>
      buildLoadedPresenceRecord()) as never,
    recordSandboxClientAttach: async () => {},
    recordSandboxClientRelease: async () => ({
      released: true,
      sessionRowId: "presence-row-1",
      releasedAt: "2026-05-20T12:00:00.000Z",
      releaseEventId: "event-release-1",
      shouldQueue: true,
    }),
    queueSandboxAutoPauseCheck: async (input) => {
      queued.push(input);
    },
    resolveSandboxAutoPauseGracePeriodMs: () => 90_000,
  });

  const response = await handler(
    buildPresenceRequest("release"),
    buildSandboxRouteParams("sandbox-record-1")
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    released: true,
    queued: true,
    gracePeriodMs: 90_000,
  });
  assert.deepEqual(queued, [
    {
      sandboxRecordId: "sandbox-record-1",
      sandboxId: "vm_123",
      userId: "user-1",
      tabId: "tab-1",
      sessionId: "session-1",
      eventSeq: 2,
      sessionRowId: "presence-row-1",
      releasedAt: "2026-05-20T12:00:00.000Z",
      releaseEventId: "event-release-1",
      gracePeriodMs: 90_000,
    },
  ]);
});

test("POST /api/sandbox/[id]/presence queues a fresh release event for each attach/release cycle", async () => {
  const { createSandboxPresenceHandler } = await loadPresenceRouteModule();
  const attached: unknown[] = [];
  const released: unknown[] = [];
  const queued: unknown[] = [];
  const releaseEventIds = ["event-release-1", "event-release-2"];

  const handler = createSandboxPresenceHandler({
    loadOwnedSandboxRouteRecord: (async () =>
      buildLoadedPresenceRecord()) as never,
    recordSandboxClientAttach: async (input) => {
      attached.push(input);
    },
    recordSandboxClientRelease: async (input) => {
      released.push(input);
      const releaseIndex = released.length - 1;
      return {
        released: true,
        sessionRowId: "presence-row-1",
        releasedAt: `2026-05-20T12:0${releaseIndex}:00.000Z`,
        releaseEventId: releaseEventIds[releaseIndex],
        shouldQueue: true,
      };
    },
    queueSandboxAutoPauseCheck: async (input) => {
      queued.push(input);
    },
    resolveSandboxAutoPauseGracePeriodMs: () => 90_000,
  });

  for (const [event, eventSeq] of [
    ["attach", 1],
    ["release", 2],
    ["attach", 3],
    ["release", 4],
  ] as const) {
    const response = await handler(
      buildPresenceRequest(event, { eventSeq }),
      buildSandboxRouteParams("sandbox-record-1")
    );
    assert.equal(response.status, 200);
  }

  assert.deepEqual(
    attached.map((event) => (event as { eventSeq: number }).eventSeq),
    [1, 3]
  );
  assert.deepEqual(
    released.map((event) => (event as { eventSeq: number }).eventSeq),
    [2, 4]
  );
  assert.equal(queued.length, 2);
  assert.equal(
    (queued[0] as { releaseEventId: string }).releaseEventId,
    "event-release-1"
  );
  assert.equal(
    (queued[1] as { releaseEventId: string }).releaseEventId,
    "event-release-2"
  );
  assert.notEqual(
    (queued[0] as { releaseEventId: string }).releaseEventId,
    (queued[1] as { releaseEventId: string }).releaseEventId
  );
});

test("POST /api/sandbox/[id]/presence makes duplicate releases no-ops", async () => {
  const { createSandboxPresenceHandler } = await loadPresenceRouteModule();
  let queued = false;

  const handler = createSandboxPresenceHandler({
    loadOwnedSandboxRouteRecord: (async () =>
      buildLoadedPresenceRecord()) as never,
    recordSandboxClientAttach: async () => {},
    recordSandboxClientRelease: async () => ({
      released: false,
      shouldQueue: false,
    }),
    queueSandboxAutoPauseCheck: async () => {
      queued = true;
    },
  });

  const response = await handler(
    buildPresenceRequest("release"),
    buildSandboxRouteParams("sandbox-record-1")
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { released: false, queued: false });
  assert.equal(queued, false);
});

test("POST /api/sandbox/[id]/presence can retry queueing an already released row", async () => {
  const { createSandboxPresenceHandler } = await loadPresenceRouteModule();
  const queued: unknown[] = [];

  const handler = createSandboxPresenceHandler({
    loadOwnedSandboxRouteRecord: (async () =>
      buildLoadedPresenceRecord()) as never,
    recordSandboxClientAttach: async () => {},
    recordSandboxClientRelease: async () => ({
      released: false,
      sessionRowId: "presence-row-1",
      releasedAt: "2026-05-20T12:00:00.000Z",
      releaseEventId: "event-release-1",
      shouldQueue: true,
    }),
    queueSandboxAutoPauseCheck: async (input) => {
      queued.push(input);
    },
    resolveSandboxAutoPauseGracePeriodMs: () => 90_000,
  });

  const response = await handler(
    buildPresenceRequest("release"),
    buildSandboxRouteParams("sandbox-record-1")
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    released: false,
    queued: true,
    gracePeriodMs: 90_000,
  });
  assert.deepEqual(queued, [
    {
      sandboxRecordId: "sandbox-record-1",
      sandboxId: "vm_123",
      userId: "user-1",
      tabId: "tab-1",
      sessionId: "session-1",
      eventSeq: 2,
      sessionRowId: "presence-row-1",
      releasedAt: "2026-05-20T12:00:00.000Z",
      releaseEventId: "event-release-1",
      gracePeriodMs: 90_000,
    },
  ]);
});
