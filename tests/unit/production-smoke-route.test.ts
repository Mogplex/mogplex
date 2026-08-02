import assert from "node:assert/strict";
import test from "node:test";

async function loadProductionSmokeRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/cron/production-smoke/route");
}

test("GET /api/cron/production-smoke returns 200 when all checks pass", async () => {
  const { createProductionSmokeGetHandler } = await loadProductionSmokeRoute();

  const handler = createProductionSmokeGetHandler({
    requireMachineApiAuth: () => null,
    runProductionSmokeChecks: async () => ({
      ok: true,
      checkedAt: "2026-04-02T17:45:00.000Z",
      checks: [{ name: "repos_select", ok: true, detail: "repos ok" }],
    }),
  });

  const response = await handler(
    new Request("http://localhost/api/cron/production-smoke")
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    checkedAt: "2026-04-02T17:45:00.000Z",
    checks: [{ name: "repos_select", ok: true, detail: "repos ok" }],
  });
});

test("GET /api/cron/production-smoke returns 500 when any check fails", async () => {
  const { createProductionSmokeGetHandler } = await loadProductionSmokeRoute();

  const handler = createProductionSmokeGetHandler({
    requireMachineApiAuth: () => null,
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
