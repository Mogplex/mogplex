import assert from "node:assert/strict";
import test from "node:test";

async function loadReconcileRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/cron/reconcile-vercel-links/route");
}

test("GET /api/cron/reconcile-vercel-links delegates to the shared runner and preserves the response shape", async () => {
  const { createReconcileVercelLinksGetHandler } = await loadReconcileRoute();
  let calls = 0;

  const handler = createReconcileVercelLinksGetHandler({
    requireMachineApiAuth: () => null,
    runVercelLinkReconciliation: async () => {
      calls += 1;
      return {
        processed: 4,
        valid: 1,
        missing_project: 1,
        auth_invalid: 0,
        inaccessible: 0,
        failed: 1,
      };
    },
  });

  const response = await handler(
    new Request("http://localhost/api/cron/reconcile-vercel-links")
  );

  assert.equal(response.status, 200);
  assert.equal(calls, 1);
  assert.deepEqual(await response.json(), {
    message: "Reconciled 4 Vercel billing link(s)",
    processed: 4,
    valid: 1,
    missing_project: 1,
    auth_invalid: 0,
    inaccessible: 0,
    failed: 1,
  });
});
