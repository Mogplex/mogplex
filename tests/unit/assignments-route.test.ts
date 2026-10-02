import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";

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

test("GET isolates assignment queries by verified repository ownership scope", async () => {
  const { createAssignmentsGetHandler } = await loadAssignmentsRoute();
  const teamId = "11111111-2222-3333-4444-555555555555";
  const requests: URL[] = [];
  const db = createClient("https://db.invalid", "fixture-key", {
    global: {
      fetch: async (input) => {
        const url = new URL(String(input));
        requests.push(url);
        if (url.pathname.endsWith("/repos")) {
          const team =
            url.searchParams.get("product_team_id") === `eq.${teamId}`;
          assert.equal(
            url.searchParams.get("owner_type"),
            team ? "eq.team" : "eq.user"
          );
          if (!team) {
            assert.equal(url.searchParams.get("owner_user_id"), "eq.user-123");
            assert.equal(url.searchParams.get("product_team_id"), "is.null");
          }
          return Response.json([{ id: team ? "team-repo" : "personal-repo" }]);
        }
        if (url.pathname.endsWith("/assignments")) {
          const team = url.searchParams.get("repo_id") === "in.(team-repo)";
          assert.equal(
            url.searchParams.get("repo_id"),
            team ? "in.(team-repo)" : "in.(personal-repo)"
          );
          return Response.json([
            {
              id: team ? "team-assignment" : "personal-assignment",
              repo_id: team ? "team-repo" : "personal-repo",
            },
          ]);
        }
        return Response.json([]);
      },
    },
  });
  let member = true;
  const handler = createAssignmentsGetHandler({
    requireUserId: async () => "user-123",
    db,
    resolveActiveTeamCapabilities: async (user, team) => {
      assert.equal(user, "user-123");
      assert.equal(team, teamId);
      return member
        ? { ok: true, teamId, capabilities: new Set() }
        : { ok: false, status: 403, error: "Forbidden" };
    },
  });
  for (const activeTeam of [null, teamId]) {
    const response = await handler(
      new Request("http://localhost/api/assignments", {
        headers: activeTeam ? { "x-mogplex-team-id": activeTeam } : {},
      })
    );
    assert.equal(response.status, 200);
    const rows = await response.json();
    assert.equal(
      rows[0].id,
      activeTeam ? "team-assignment" : "personal-assignment"
    );
  }
  const before = requests.length;
  member = false;
  const forbidden = await handler(
    new Request("http://localhost/api/assignments", {
      headers: { "x-mogplex-team-id": teamId },
    })
  );
  assert.equal(forbidden.status, 403);
  assert.equal(requests.length, before);
});
