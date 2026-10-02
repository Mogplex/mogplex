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
        if (url.pathname.endsWith("/assignments")) {
          const team =
            url.searchParams.get("repos.product_team_id") === `eq.${teamId}`;
          assert.equal(url.searchParams.get("select"), "*,repos!inner(id)");
          assert.equal(
            url.searchParams.get("repos.owner_type"),
            team ? "eq.team" : "eq.user"
          );
          assert.equal(url.searchParams.has("repo_id"), false);
          if (!team) {
            assert.equal(
              url.searchParams.get("repos.owner_user_id"),
              "eq.user-123"
            );
            assert.equal(
              url.searchParams.get("repos.product_team_id"),
              "is.null"
            );
          }
          return Response.json([
            {
              id: team ? "team-assignment" : "personal-assignment",
              repo_id: team ? "team-repo" : "personal-repo",
              repos: { id: team ? "team-repo" : "personal-repo" },
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
    assert.equal(rows[0].can_manage, !activeTeam);
    assert.equal(rows[0].repos, undefined);
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

test("team assignment writes use team capability and joined ownership, not creator identity", async () => {
  const { createAssignmentsPutHandler, createAssignmentsDeleteHandler } =
    await loadAssignmentsRoute();
  const teamId = "11111111-2222-3333-4444-555555555555";
  const requests: Array<{ url: URL; method: string }> = [];
  let lookup: "found" | "missing" | "error" = "found";
  const db = createClient("https://db.invalid", "fixture-key", {
    global: {
      fetch: async (input, init) => {
        const url = new URL(String(input));
        const method = init?.method ?? "GET";
        requests.push({ url, method });
        assert.equal(url.pathname.endsWith("/assignments"), true);
        assert.equal(url.searchParams.get("id"), "eq.assignment-1");
        if (method === "GET") {
          assert.equal(
            url.searchParams.get("select"),
            "id,repo_id,repos!inner(id)"
          );
          assert.equal(url.searchParams.get("repos.owner_type"), "eq.team");
          assert.equal(
            url.searchParams.get("repos.product_team_id"),
            `eq.${teamId}`
          );
          assert.equal(url.searchParams.has("repos.user_id"), false);
          if (lookup === "error")
            return Response.json(
              { message: "Lookup unavailable", code: "XX000" },
              { status: 500 }
            );
          return Response.json(
            lookup === "missing"
              ? []
              : [
                  {
                    id: "assignment-1",
                    repo_id: "repo-created-by-another-member",
                  },
                ]
          );
        }
        assert.equal(
          url.searchParams.get("repo_id"),
          "eq.repo-created-by-another-member"
        );
        return method === "DELETE"
          ? new Response(null, { status: 204 })
          : Response.json({ id: "assignment-1", enabled: false });
      },
    },
  });
  let canWrite = true;
  let member = true;
  const deps = {
    requireUserId: async () => "user-123",
    db,
    resolveActiveTeamCapabilities: async () =>
      member
        ? {
            ok: true as const,
            teamId,
            capabilities: new Set<
              import("../../lib/team-capabilities").Capability
            >(canWrite ? ["projects.write"] : []),
          }
        : { ok: false as const, status: 403 as const, error: "Forbidden" },
  };
  const put = createAssignmentsPutHandler(deps);
  const remove = createAssignmentsDeleteHandler(deps);
  const request = (method: "PUT" | "DELETE") =>
    new Request(
      `http://localhost/api/assignments${method === "DELETE" ? "?id=assignment-1" : ""}`,
      {
        method,
        headers: {
          "x-mogplex-team-id": teamId,
          "content-type": "application/json",
        },
        ...(method === "PUT"
          ? { body: JSON.stringify({ id: "assignment-1", enabled: false }) }
          : {}),
      }
    );
  assert.equal((await put(request("PUT"))).status, 200);
  assert.equal((await remove(request("DELETE"))).status, 200);
  assert.deepEqual(
    requests.map(({ method }) => method),
    ["GET", "PATCH", "GET", "DELETE"]
  );
  for (const mode of ["viewer", "non-member"] as const) {
    canWrite = false;
    member = mode === "viewer";
    const before = requests.length;
    assert.equal((await put(request("PUT"))).status, 403);
    assert.equal((await remove(request("DELETE"))).status, 403);
    assert.equal(requests.length, before);
  }
  member = true;
  canWrite = true;
  lookup = "missing";
  assert.equal((await put(request("PUT"))).status, 404);
  assert.equal((await remove(request("DELETE"))).status, 404);
  lookup = "error";
  assert.equal((await put(request("PUT"))).status, 500);
  assert.equal((await remove(request("DELETE"))).status, 500);
  assert.equal(requests.filter(({ method }) => method !== "GET").length, 2);
});
