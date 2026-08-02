import assert from "node:assert/strict";
import test from "node:test";
import { resolveScope, type ScopeLookup } from "../../lib/middleware-scope";

function makeDb(overrides: Partial<ScopeLookup> = {}): ScopeLookup {
  return {
    findProfileBySlug: async () => null,
    findTeamBySlug: async () => null,
    isTeamMember: async () => false,
    ...overrides,
  };
}

test("resolveScope returns not_found for a reserved slug (without querying the DB)", async () => {
  let queried = false;
  const result = await resolveScope(
    "api",
    "profile-1",
    makeDb({
      findProfileBySlug: async () => {
        queried = true;
        return null;
      },
      findTeamBySlug: async () => {
        queried = true;
        return null;
      },
    })
  );
  assert.deepEqual(result, { status: "not_found" });
  assert.equal(queried, false);
});

test("resolveScope returns not_found for an unknown slug", async () => {
  const result = await resolveScope("nobody", "profile-1", makeDb());
  assert.deepEqual(result, { status: "not_found" });
});

test("resolveScope returns redirect_login when slug exists but caller is unauthed", async () => {
  const result = await resolveScope(
    "alice",
    null,
    makeDb({
      findProfileBySlug: async () => ({ id: "profile-alice" }),
    })
  );
  assert.deepEqual(result, { status: "redirect_login" });
});

test("resolveScope returns personal scope when the authed user owns the slug", async () => {
  const result = await resolveScope(
    "alice",
    "profile-alice",
    makeDb({
      findProfileBySlug: async () => ({ id: "profile-alice" }),
    })
  );
  assert.deepEqual(result, {
    status: "personal",
    slug: "alice",
    profileId: "profile-alice",
  });
});

test("resolveScope returns not_found when a personal slug belongs to a different user", async () => {
  const result = await resolveScope(
    "alice",
    "profile-bob",
    makeDb({
      findProfileBySlug: async () => ({ id: "profile-alice" }),
    })
  );
  // Don't reveal that alice's slug exists.
  assert.deepEqual(result, { status: "not_found" });
});

test("resolveScope returns team scope when the user is a team member", async () => {
  const result = await resolveScope(
    "acme",
    "profile-alice",
    makeDb({
      findTeamBySlug: async () => ({ id: "team-acme" }),
      isTeamMember: async (teamId, userId) => {
        assert.equal(teamId, "team-acme");
        assert.equal(userId, "profile-alice");
        return true;
      },
    })
  );
  assert.deepEqual(result, {
    status: "team",
    slug: "acme",
    teamId: "team-acme",
  });
});

test("resolveScope returns not_found for a team slug when the user is not a member", async () => {
  const result = await resolveScope(
    "acme",
    "profile-stranger",
    makeDb({
      findTeamBySlug: async () => ({ id: "team-acme" }),
      isTeamMember: async () => false,
    })
  );
  // Don't reveal that acme exists.
  assert.deepEqual(result, { status: "not_found" });
});

test("resolveScope prefers a personal match over a team match on slug collision", async () => {
  const result = await resolveScope(
    "clash",
    "profile-alice",
    makeDb({
      findProfileBySlug: async () => ({ id: "profile-alice" }),
      findTeamBySlug: async () => ({ id: "team-clash" }),
      isTeamMember: async () => {
        throw new Error(
          "team membership should not be queried when a personal match wins"
        );
      },
    })
  );
  assert.deepEqual(result, {
    status: "personal",
    slug: "clash",
    profileId: "profile-alice",
  });
});
