import assert from "node:assert/strict";
import test from "node:test";

async function loadAssignmentsRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/assignments/route");
}

// Creating an assignment used to fork a preset agent and insert a row that the
// webhook/cron dispatchers ran directly off `agents.model`. That consumer is
// gone — the flow node owns the model — so a new row would enqueue a job
// nothing can route. POST must refuse rather than create that dead end.
test("POST /api/assignments is gone and never creates a row", async () => {
  const { POST } = await loadAssignmentsRoute();

  const response = await POST();

  assert.equal(response.status, 410);
  const body = (await response.json()) as { error?: string };
  assert.match(body.error ?? "", /automations/i);
});

test("assignments route exposes no create handler", async () => {
  const route = (await loadAssignmentsRoute()) as Record<string, unknown>;

  // The dependency-injected factory is what the old create path was tested
  // through; its absence is the signal that no insert path survives.
  assert.equal(route.createAssignmentsPostHandler, undefined);
  // Reading, disabling, and deleting an existing row must still work.
  assert.equal(typeof route.GET, "function");
  assert.equal(typeof route.PUT, "function");
  assert.equal(typeof route.DELETE, "function");
});
