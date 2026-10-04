import assert from "node:assert/strict";
import test from "node:test";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  createTeamMembersGetHandler,
  type TeamMembersResponse,
} from "../../app/api/teams/[teamId]/members/route";
import type { TeamRole } from "../../lib/team-capabilities";

const teamId = "00000000-0000-4000-8000-000000000001";
const context = (id = teamId) => ({ params: Promise.resolve({ teamId: id }) });
const request = () =>
  new Request(`http://localhost/api/teams/${teamId}/members`);
type Options = {
  actor?: TeamRole;
  failTable?: "teams" | "team_members" | "team_invites";
  missingTeam?: boolean;
  empty?: boolean;
  iconPath?: string;
};
const profile = {
  id: "user-1",
  name: "Test owner",
  username: "owner",
  github_username: "github-owner",
  email: "owner@example.com",
  avatar_url: "https://images.example/owner.png",
};

function fixture(options: Options = {}) {
  const reads: string[] = [];
  const db = createClient("https://database.example", "unit-test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input, init) => {
        assert.equal(init?.method, "GET");
        const url = new URL(String(input));
        const table = url.pathname.split("/").at(-1);
        reads.push(String(table));
        if (table === "teams")
          assert.equal(url.searchParams.get("id"), `eq.${teamId}`);
        else assert.equal(url.searchParams.get("team_id"), `eq.${teamId}`);
        if (table === options.failTable)
          return Response.json(
            { message: "Read failed", code: "XX000" },
            { status: 500 }
          );
        if (table === "teams")
          return options.missingTeam
            ? Response.json(
                { message: "No rows", code: "PGRST116" },
                { status: 406 }
              )
            : Response.json({
                id: teamId,
                name: "Test team",
                slug: "test-team",
                icon_path: options.iconPath ?? null,
              });
        if (table === "team_members") {
          assert.equal(url.searchParams.get("order"), "joined_at.asc");
          return Response.json(
            options.empty
              ? []
              : [
                  {
                    user_id: "user-1",
                    role: "owner",
                    joined_at: "2026-01-01T00:00:00Z",
                    profile,
                  },
                  {
                    user_id: "user-2",
                    role: "admin",
                    joined_at: "2026-01-02T00:00:00Z",
                    profile: [
                      {
                        ...profile,
                        id: "user-2",
                        name: null,
                        username: null,
                        github_username: "github-admin",
                      },
                    ],
                  },
                  {
                    user_id: "user-3",
                    role: "developer",
                    joined_at: "2026-01-03T00:00:00Z",
                    profile: null,
                  },
                  {
                    user_id: "user-4",
                    role: "viewer",
                    joined_at: "2026-01-04T00:00:00Z",
                    profile: [],
                  },
                ]
          );
        }
        if (table === "team_invites") {
          assert.equal(url.searchParams.get("accepted_at"), "is.null");
          assert.equal(url.searchParams.get("order"), "created_at.desc");
          return Response.json(
            options.empty
              ? []
              : [
                  {
                    id: "invite-1",
                    email: "person@example.com",
                    role: "viewer",
                    expires_at: "2026-10-10T00:00:00Z",
                    created_at: "2026-10-03T00:00:00Z",
                  },
                ]
          );
        }
        throw new Error(`Unexpected database request ${table}`);
      },
    },
  });
  const actor = options.actor ?? "owner";
  const deps = {
    db,
    requireProfileId: async () => "user-1",
    loadTeamMembershipAuth: async () => ({
      ok: true as const,
      role: actor,
      canManage: actor === "owner" || actor === "admin",
    }),
  };
  return { deps, handler: createTeamMembersGetHandler(deps), reads };
}

for (const actor of ["owner", "admin", "developer", "viewer"] as const) {
  test(`member GET returns the scoped list and ${actor} capabilities`, async () => {
    const f = fixture({ actor });
    const response = await f.handler(request(), context());
    assert.equal(response.status, 200);
    const result = (await response.json()) as TeamMembersResponse;
    assert.deepEqual(result.team, {
      id: teamId,
      name: "Test team",
      slug: "test-team",
      iconUrl: null,
    });
    assert.deepEqual(result.viewer, {
      role: actor,
      canManage: actor === "owner" || actor === "admin",
    });
    assert.deepEqual(result.members, [
      {
        userId: "user-1",
        name: "Test owner",
        username: "owner",
        email: "owner@example.com",
        avatarUrl: "https://images.example/owner.png",
        role: "owner",
        joinedAt: "2026-01-01T00:00:00Z",
        isCurrentUser: true,
      },
      {
        userId: "user-2",
        name: null,
        username: "github-admin",
        email: "owner@example.com",
        avatarUrl: "https://images.example/owner.png",
        role: "admin",
        joinedAt: "2026-01-02T00:00:00Z",
        isCurrentUser: false,
      },
      {
        userId: "user-3",
        name: null,
        username: null,
        email: null,
        avatarUrl: null,
        role: "developer",
        joinedAt: "2026-01-03T00:00:00Z",
        isCurrentUser: false,
      },
      {
        userId: "user-4",
        name: null,
        username: null,
        email: null,
        avatarUrl: null,
        role: "viewer",
        joinedAt: "2026-01-04T00:00:00Z",
        isCurrentUser: false,
      },
    ]);
    assert.deepEqual(result.invites, [
      {
        id: "invite-1",
        email: "person@example.com",
        role: "viewer",
        expiresAt: "2026-10-10T00:00:00Z",
        createdAt: "2026-10-03T00:00:00Z",
      },
    ]);
    assert.deepEqual(f.reads.toSorted(), [
      "team_invites",
      "team_members",
      "teams",
    ]);
  });
}

for (const id of [
  "bad-team",
  "",
  "123",
  "00000000-0000-4000-8000-00000000000z",
]) {
  test(`member GET rejects malformed team ID ${id} before database access`, async () => {
    const f = fixture();
    const handler = createTeamMembersGetHandler({
      ...f.deps,
      loadTeamMembershipAuth: async () => {
        throw new Error("Invalid team reached membership lookup");
      },
    });
    const response = await handler(request(), context(id));
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "Invalid team ID.",
      details: { formErrors: [], fieldErrors: { teamId: ["Invalid uuid"] } },
    });
    assert.deepEqual(f.reads, []);
  });
}

test("member GET checks sign-in before ID validation", async () => {
  const f = fixture();
  const handler = createTeamMembersGetHandler({
    ...f.deps,
    requireProfileId: async () =>
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    loadTeamMembershipAuth: async () => {
      throw new Error("Unsigned lookup");
    },
  });
  const response = await handler(request(), context("bad"));
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Unauthorized" });
  assert.deepEqual(f.reads, []);
});

for (const status of [403, 404, 500] as const) {
  test(`member GET preserves membership authorization failure ${status}`, async () => {
    const f = fixture();
    const handler = createTeamMembersGetHandler({
      ...f.deps,
      loadTeamMembershipAuth: async () => ({
        ok: false,
        status,
        error: "Auth failed",
      }),
    });
    const response = await handler(request(), context());
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error: "Auth failed" });
    assert.deepEqual(f.reads, []);
  });
}

for (const failTable of ["teams", "team_members", "team_invites"] as const) {
  test(`member GET preserves ${failTable} read failure`, async () => {
    const f = fixture({ failTable });
    const response = await f.handler(request(), context());
    assert.equal(response.status, failTable === "teams" ? 404 : 500);
    assert.deepEqual(await response.json(), {
      error: failTable === "teams" ? "Team not found" : "Read failed",
    });
  });
}

test("member GET returns 404 when the authorized team disappears", async () => {
  const f = fixture({ missingTeam: true });
  const response = await f.handler(request(), context());
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Team not found" });
});

test("member GET returns empty collections when no rows remain", async () => {
  const f = fixture({ empty: true });
  const response = await f.handler(request(), context());
  assert.equal(response.status, 200);
  const result = (await response.json()) as TeamMembersResponse;
  assert.deepEqual(result.members, []);
  assert.deepEqual(result.invites, []);
});

test("member GET rejects unsafe saved icon paths through the real presenter", async () => {
  const f = fixture({ iconPath: "../unsafe" });
  const response = await f.handler(request(), context());
  assert.equal(response.status, 200);
  assert.equal(
    ((await response.json()) as TeamMembersResponse).team.iconUrl,
    null
  );
});
