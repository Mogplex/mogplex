import assert from "node:assert/strict";
import test from "node:test";

function setEnv() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
}

async function loadLogger() {
  setEnv();
  return import("../../lib/connections/logging");
}

test("buildConnectionEventInsert: returns null for console-only events", async () => {
  const { buildConnectionEventInsert } = await loadLogger();

  // Successful loads are intentionally NOT persisted — keeps row
  // volume bounded and matches the "failures-only" v1 scope. PR B's
  // 24h failure-rate aggregations only need the failed branch.
  const created = buildConnectionEventInsert("connection_created", {
    userId: "u1",
    connectionId: "c1",
    surface: "test",
  });
  assert.equal(created, null);

  const succeeded = buildConnectionEventInsert("connection_test_succeeded", {
    userId: "u1",
    connectionId: "c1",
    surface: "test",
  });
  assert.equal(succeeded, null);

  const overrideChanged = buildConnectionEventInsert(
    "connection_override_changed",
    {
      userId: "u1",
      connectionId: "c1",
    }
  );
  assert.equal(overrideChanged, null);
});

test("buildConnectionEventInsert: returns null AND warns when required identity fields are missing on a persistable event", async () => {
  const { buildConnectionEventInsert } = await loadLogger();

  // Capture console.warn so the test asserts the loud signal that
  // catches call-site bugs (forgot to thread userId / surface).
  // Without this branch, future call sites that silently emit
  // persistable events without their required fields would
  // accumulate as gaps in the failure ledger — the entire point of
  // PR A is to make those gaps queryable.
  const originalWarn = console.warn;
  const warnings: Array<{ msg: string; ctx: unknown }> = [];
  console.warn = ((msg: string, ctx?: unknown) => {
    if (typeof msg === "string" && msg.startsWith("[connections]")) {
      warnings.push({ msg, ctx });
    } else {
      originalWarn(msg, ctx);
    }
  }) as typeof console.warn;

  try {
    const noConnection = buildConnectionEventInsert(
      "connection_runtime_load_failed",
      { userId: "u1", surface: "chat" }
    );
    assert.equal(noConnection, null);

    const noUser = buildConnectionEventInsert(
      "connection_runtime_load_failed",
      { connectionId: "c1", surface: "chat" }
    );
    assert.equal(noUser, null);

    const noSurface = buildConnectionEventInsert(
      "connection_runtime_load_failed",
      { userId: "u1", connectionId: "c1" }
    );
    assert.equal(noSurface, null);

    // Each persistable-event call site that misses required fields
    // produces exactly one warning with structured context so an
    // operator grepping logs can identify which field was missing.
    assert.equal(warnings.length, 3);
    assert.ok(warnings[0]?.msg.includes("missing required fields"));
    const noUserCtx = warnings[1]?.ctx as Record<string, unknown>;
    assert.equal(noUserCtx.hasUserId, false);
    assert.equal(noUserCtx.hasConnectionId, true);
    const noSurfaceCtx = warnings[2]?.ctx as Record<string, unknown>;
    assert.equal(noSurfaceCtx.hasSurface, false);
  } finally {
    console.warn = originalWarn;
  }
});

test("buildConnectionEventInsert: console-only events do NOT warn when fields are absent (silent skip is correct)", async () => {
  const { buildConnectionEventInsert } = await loadLogger();

  // connection_created etc. are intentionally console-only — they
  // have no DB type to map to and shouldn't trigger the call-site
  // bug warning. This test pins that the loud path only fires for
  // PERSISTABLE events with missing fields.
  const originalWarn = console.warn;
  let warnCount = 0;
  console.warn = ((msg: string) => {
    if (typeof msg === "string" && msg.startsWith("[connections]")) {
      warnCount += 1;
    }
  }) as typeof console.warn;

  try {
    buildConnectionEventInsert("connection_created", {});
    buildConnectionEventInsert("connection_test_succeeded", {});
    buildConnectionEventInsert("connection_create_failed", {});
    buildConnectionEventInsert("connection_runtime_skipped", {});
    assert.equal(warnCount, 0);
  } finally {
    console.warn = originalWarn;
  }
});

test("buildConnectionEventInsert: maps connection_runtime_load_failed (chat) to runtime_load_failed", async () => {
  const { buildConnectionEventInsert } = await loadLogger();

  const insert = buildConnectionEventInsert("connection_runtime_load_failed", {
    userId: "u1",
    connectionId: "c1",
    repoId: "r1",
    presetId: "linear",
    connectionType: "mcp_server",
    authType: "oauth",
    reason: "Connection refused",
    surface: "chat",
    aiCallId: "ai-1",
  });

  assert.ok(insert);
  assert.equal(insert.connection_id, "c1");
  assert.equal(insert.user_id, "u1");
  assert.equal(insert.event_type, "runtime_load_failed");
  assert.equal(insert.surface, "chat");
  assert.equal(insert.ai_call_id, "ai-1");
  assert.equal(insert.message, "Connection refused");
  assert.equal(insert.payload.preset, "linear");
  assert.equal(insert.payload.auth_type, "oauth");
  assert.equal(insert.payload.connection_type, "mcp_server");
  assert.equal(insert.payload.repo_id, "r1");
});

test("buildConnectionEventInsert: maps connection_runtime_load_failed (harness) keeping the surface distinction", async () => {
  // The same DB event_type covers both surfaces; the `surface`
  // column distinguishes them. This is what /api/observability/stats
  // (PR B) will group by to answer "are harness MCPs failing more
  // than chat MCPs?" — collapsing them to a single event_type with
  // a payload field would lose the index-friendly column.
  const { buildConnectionEventInsert } = await loadLogger();

  const insert = buildConnectionEventInsert("connection_runtime_load_failed", {
    userId: "u1",
    connectionId: "c1",
    surface: "harness",
    reason: "OAuth refresh token expired",
  });

  assert.ok(insert);
  assert.equal(insert.event_type, "runtime_load_failed");
  assert.equal(insert.surface, "harness");
  assert.equal(insert.message, "OAuth refresh token expired");
});

test("buildConnectionEventInsert: maps connection_test_persist_failed to test_persist_failed", async () => {
  const { buildConnectionEventInsert } = await loadLogger();

  const insert = buildConnectionEventInsert("connection_test_persist_failed", {
    userId: "u1",
    connectionId: "c1",
    surface: "test",
    healthStatus: "healthy",
    httpStatus: 200,
    toolCount: 12,
    reason: "Database write timed out",
  });

  assert.ok(insert);
  assert.equal(insert.event_type, "test_persist_failed");
  assert.equal(insert.surface, "test");
  assert.equal(insert.payload.health_status, "healthy");
  assert.equal(insert.payload.http_status, 200);
  assert.equal(insert.payload.tool_count, 12);
});

test("buildConnectionEventInsert: payloadExtras merges into payload (used by the reaper for { age_ms, source })", async () => {
  // The reaper writes connection_events through the logger so the
  // shape contract is enforced at the type level (see PR review
  // finding #3). Reaper-specific metadata — age_ms and source —
  // rides in payloadExtras to avoid widening the strongly-typed
  // core fields. This test pins the merge order so a future change
  // doesn't accidentally let a core field shadow an extras field.
  const { buildConnectionEventInsert } = await loadLogger();

  const insert = buildConnectionEventInsert("connection_test_failed", {
    userId: "u1",
    connectionId: "c1",
    surface: "reaper",
    reason: "Test interrupted before persistence (reaped by zombie-row-reaper)",
    payloadExtras: { age_ms: 16 * 60 * 1000, source: "zombie-row-reaper" },
  });

  assert.ok(insert);
  assert.equal(insert.event_type, "test_failed");
  assert.equal(insert.surface, "reaper");
  assert.equal(insert.payload.age_ms, 16 * 60 * 1000);
  assert.equal(insert.payload.source, "zombie-row-reaper");
  // Core fields default to null when not provided; extras don't
  // shadow them because they're disjoint key spaces.
  assert.equal(insert.payload.preset, null);
  assert.equal(insert.payload.connection_type, null);
});

test("buildConnectionEventInsert: missing optional fields default to null in payload (not undefined)", async () => {
  // The connection_events.payload column is JSONB — JSON.stringify
  // would drop undefined keys, leaving the operator unable to
  // distinguish "field not set" from "field set to null." Defaulting
  // to null at the builder layer keeps the wire shape predictable
  // for downstream queries and dashboards.
  const { buildConnectionEventInsert } = await loadLogger();

  const insert = buildConnectionEventInsert("connection_runtime_load_failed", {
    userId: "u1",
    connectionId: "c1",
    surface: "chat",
  });

  assert.ok(insert);
  assert.equal(insert.payload.preset, null);
  assert.equal(insert.payload.connection_type, null);
  assert.equal(insert.payload.auth_type, null);
  assert.equal(insert.payload.health_status, null);
  assert.equal(insert.payload.http_status, null);
  assert.equal(insert.payload.tool_count, null);
  assert.equal(insert.payload.repo_id, null);
  assert.equal(insert.message, null);
  assert.equal(insert.ai_call_id, null);
});

// Note: an integration test that mocks supabaseAdmin.from to verify
// the persist boundary was attempted but dropped. tsx/node test
// resolution captures the supabaseAdmin import at first-load time,
// so a later Object.defineProperty on supabaseAdmin doesn't reach
// the cached logger module's binding when the logger was imported
// in an earlier test in the same file. The pure
// `buildConnectionEventInsert` tests above pin the row shape; the
// `supabaseAdmin.from("connection_events").insert(...)` wire-up is a
// one-line read-by-inspection in lib/connections/logging.ts. Same
// rationale used for skipping the upsertSandboxLaunchPreset DB-mock
// test in the #309 cleanup PR (extracted shouldRejectAtCap as the
// pure testable predicate; the DB call site stayed unverified).
