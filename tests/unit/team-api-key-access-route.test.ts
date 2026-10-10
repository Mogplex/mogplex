import assert from "node:assert/strict";
import test from "node:test";
import type { ApiKeyAccess } from "../../lib/mogplex-api/credential-boundary";

type Role = "owner" | "admin" | "developer" | "viewer";

function configureEnv() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
}

/** In-memory stand-in for teams.api_key_access, with a log of side effects. */
function makeStorage(initial: Record<string, ApiKeyAccess>) {
  const values = new Map(Object.entries(initial));
  const log = {
    writes: [] as Array<{ teamId: string; access: ApiKeyAccess }>,
    audits: [] as Array<{
      teamId: string;
      actorId: string;
      from: ApiKeyAccess;
      to: ApiKeyAccess;
    }>,
  };
  return {
    values,
    log,
    deps: {
      read: async (teamId: string) => values.get(teamId) ?? null,
      write: async (teamId: string, access: ApiKeyAccess) => {
        if (!values.has(teamId)) return false;
        values.set(teamId, access);
        log.writes.push({ teamId, access });
        return true;
      },
      onChanged: async (change: {
        teamId: string;
        actorId: string;
        from: ApiKeyAccess;
        to: ApiKeyAccess;
      }) => {
        log.audits.push(change);
      },
    },
  };
}

async function handlersFor(
  role: Role | null,
  storage: ReturnType<typeof makeStorage>
) {
  configureEnv();
  const { createTeamApiKeyAccessHandlers } =
    await import("../../app/api/teams/[teamId]/api-key-access/route");
  return createTeamApiKeyAccessHandlers({
    ...storage.deps,
    requireProfileId: async () => "user-1",
    loadTeamMembershipAuth: async () =>
      role === null
        ? { ok: false, status: 403, error: "Forbidden" }
        : {
            ok: true,
            role,
            canManage: role === "owner" || role === "admin",
          },
  });
}

function patch(body: unknown) {
  return new Request("https://mogplex.test/api", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const teamContext = { params: Promise.resolve({ teamId: "team-1" }) };

test("a team member reads the team's key access and sees they may not change it", async () => {
  const storage = makeStorage({ "team-1": "full" });
  const handlers = await handlersFor("developer", storage);

  const response = await handlers.GET(
    new Request("https://mogplex.test/api"),
    teamContext
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    access: "full",
    viewer: { canManage: false },
  });
});

test("a team owner sees they may change the team's key access", async () => {
  const storage = makeStorage({ "team-1": "full" });
  const handlers = await handlersFor("owner", storage);

  const response = await handlers.GET(
    new Request("https://mogplex.test/api"),
    teamContext
  );

  assert.deepEqual((await response.json()).viewer, { canManage: true });
});

for (const role of ["admin", "developer", "viewer"] as const) {
  test(`a team ${role} cannot change the team's key access`, async () => {
    const storage = makeStorage({ "team-1": "full" });
    const handlers = await handlersFor(role, storage);

    const response = await handlers.PATCH(
      patch({ access: "automations" }),
      teamContext
    );

    assert.equal(response.status, 403);
    assert.equal(storage.values.get("team-1"), "full");
    assert.deepEqual(storage.log.writes, []);
    assert.deepEqual(storage.log.audits, []);
  });
}

test("someone outside the team can neither read nor change it", async () => {
  const storage = makeStorage({ "team-1": "full" });
  const handlers = await handlersFor(null, storage);

  const read = await handlers.GET(
    new Request("https://mogplex.test/api"),
    teamContext
  );
  const write = await handlers.PATCH(
    patch({ access: "automations" }),
    teamContext
  );

  assert.equal(read.status, 403);
  assert.equal(write.status, 403);
  assert.deepEqual(storage.log.writes, []);
});

test("a team owner holding keys to automations stores it and audits the change", async () => {
  const storage = makeStorage({ "team-1": "full" });
  const handlers = await handlersFor("owner", storage);

  const response = await handlers.PATCH(
    patch({ access: "automations" }),
    teamContext
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    access: "automations",
    viewer: { canManage: true },
  });
  assert.equal(storage.values.get("team-1"), "automations");
  assert.deepEqual(storage.log.audits, [
    { teamId: "team-1", actorId: "user-1", from: "full", to: "automations" },
  ]);
});

test("saving the same access again writes no audit event", async () => {
  const storage = makeStorage({ "team-1": "automations" });
  const handlers = await handlersFor("owner", storage);

  await handlers.PATCH(patch({ access: "automations" }), teamContext);

  assert.deepEqual(storage.log.audits, []);
});

test("an unknown access level is rejected without a write", async () => {
  const storage = makeStorage({ "team-1": "full" });
  const handlers = await handlersFor("owner", storage);

  const response = await handlers.PATCH(patch({ access: "none" }), teamContext);

  assert.equal(response.status, 422);
  assert.deepEqual(storage.log.writes, []);
});
