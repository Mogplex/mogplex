import assert from "node:assert/strict";
import test from "node:test";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

async function loadProductionSmokeRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/cron/production-smoke/route");
}

test("GET /api/cron/production-smoke returns 200 when all checks pass", async () => {
  const { createProductionSmokeGetHandler } = await loadProductionSmokeRoute();
  const adminClient = { source: "scoped" } as unknown as SupabaseClient;
  let connectionRuns = 0;
  let insideConnection = false;

  const handler = createProductionSmokeGetHandler({
    requireMachineApiAuth: () => null,
    withSupabaseAdminConnection: async (operation) => {
      connectionRuns += 1;
      insideConnection = true;
      try {
        return await operation(adminClient);
      } finally {
        insideConnection = false;
      }
    },
    runProductionSmokeChecks: async (client) => {
      assert.equal(insideConnection, true);
      assert.equal(client, adminClient);
      return {
        ok: true,
        checkedAt: "2026-04-02T17:45:00.000Z",
        checks: [{ name: "repos_select", ok: true, detail: "repos ok" }],
      };
    },
  });

  const response = await handler(
    new Request("http://localhost/api/cron/production-smoke")
  );

  assert.equal(response.status, 200);
  assert.equal(connectionRuns, 1);
  assert.deepEqual(await response.json(), {
    ok: true,
    checkedAt: "2026-04-02T17:45:00.000Z",
    checks: [{ name: "repos_select", ok: true, detail: "repos ok" }],
  });
});

test("GET /api/cron/production-smoke returns 500 when any check fails", async () => {
  const { createProductionSmokeGetHandler } = await loadProductionSmokeRoute();
  const adminClient = {} as SupabaseClient;

  const handler = createProductionSmokeGetHandler({
    requireMachineApiAuth: () => null,
    withSupabaseAdminConnection: (operation) => operation(adminClient),
    runProductionSmokeChecks: async () => ({
      ok: false,
      checkedAt: "2026-04-02T17:45:00.000Z",
      checks: [{ name: "repos_select", ok: false, detail: "missing column" }],
    }),
  });

  const response = await handler(
    new Request("http://localhost/api/cron/production-smoke")
  );

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    ok: false,
    checkedAt: "2026-04-02T17:45:00.000Z",
    checks: [{ name: "repos_select", ok: false, detail: "missing column" }],
  });
});

test("GET /api/cron/production-smoke skips database checkout when authentication fails", async () => {
  const { createProductionSmokeGetHandler } = await loadProductionSmokeRoute();
  let connectionRuns = 0;
  let smokeRuns = 0;
  const handler = createProductionSmokeGetHandler({
    requireMachineApiAuth: () =>
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    withSupabaseAdminConnection: async () => {
      connectionRuns += 1;
      throw new Error("database should not be reached");
    },
    runProductionSmokeChecks: async () => {
      smokeRuns += 1;
      throw new Error("smoke should not run");
    },
  });

  const response = await handler(
    new Request("http://localhost/api/cron/production-smoke")
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Unauthorized" });
  assert.equal(connectionRuns, 0);
  assert.equal(smokeRuns, 0);
});

test("GET /api/cron/production-smoke returns JSON when admin connection checkout fails", async () => {
  const { createProductionSmokeGetHandler } = await loadProductionSmokeRoute();
  const handler = createProductionSmokeGetHandler({
    requireMachineApiAuth: () => null,
    withSupabaseAdminConnection: async () => {
      throw new Error("pool timeout");
    },
    runProductionSmokeChecks: async () => {
      throw new Error("smoke should not run");
    },
  });
  const originalConsoleError = console.error;
  const logged: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    logged.push(args);
  };

  try {
    const response = await handler(
      new Request("http://localhost/api/cron/production-smoke")
    );

    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      ok: false,
      error: "Production smoke unavailable",
    });
    assert.deepEqual(logged, [
      [
        "[production-smoke] admin connection run failed",
        { error: "pool timeout" },
      ],
    ]);
  } finally {
    console.error = originalConsoleError;
  }
});
