import assert from "node:assert/strict";
import test from "node:test";
import type { DecisionChecksOwner } from "../../lib/decisions/account-setting";

function configureEnv() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
}

type Role = "owner" | "admin" | "developer" | "viewer";

/** In-memory stand-in for the two columns, with a log of every side effect. */
function makeStorage(initial: Record<string, boolean>) {
  const values = new Map(Object.entries(initial));
  const log = {
    writes: [] as Array<{ key: string; enabled: boolean }>,
    forgotten: [] as string[],
    audits: [] as Array<{
      key: string;
      actorId: string;
      from: boolean;
      to: boolean;
    }>,
  };
  const keyOf = (owner: DecisionChecksOwner) => `${owner.table}:${owner.id}`;
  return {
    values,
    log,
    deps: {
      read: async (owner: DecisionChecksOwner) =>
        values.get(keyOf(owner)) ?? null,
      write: async (owner: DecisionChecksOwner, enabled: boolean) => {
        if (!values.has(keyOf(owner))) return false;
        values.set(keyOf(owner), enabled);
        log.writes.push({ key: keyOf(owner), enabled });
        return true;
      },
      forget: (owner: DecisionChecksOwner) => {
        log.forgotten.push(keyOf(owner));
      },
      onChanged: async (change: {
        owner: DecisionChecksOwner;
        actorId: string;
        from: boolean;
        to: boolean;
      }) => {
        log.audits.push({
          key: keyOf(change.owner),
          actorId: change.actorId,
          from: change.from,
          to: change.to,
        });
      },
    },
  };
}

function patch(body: unknown) {
  return new Request("https://mogplex.test/api", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function teamHandlers(input: {
  role: Role | null;
  storage: ReturnType<typeof makeStorage>;
  signedIn?: boolean;
}) {
  configureEnv();
  const { createTeamDecisionChecksHandlers } =
    await import("../../app/api/teams/[teamId]/decision-checks/route");
  return createTeamDecisionChecksHandlers({
    ...input.storage.deps,
    requireProfileId: async () =>
      input.signedIn === false
        ? Response.json({ error: "Unauthorized" }, { status: 401 })
        : "user-1",
    loadTeamMembershipAuth: async () =>
      input.role === null
        ? { ok: false, status: 403, error: "Forbidden" }
        : {
            ok: true,
            role: input.role,
            canManage: input.role === "owner" || input.role === "admin",
          },
  });
}

const teamContext = { params: Promise.resolve({ teamId: "team-1" }) };

test("a team member can read the team setting and sees whether they may change it", async () => {
  const storage = makeStorage({ "teams:team-1": true });
  const handlers = await teamHandlers({ role: "developer", storage });

  const response = await handlers.GET(
    new Request("https://mogplex.test/api"),
    teamContext
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    enabled: true,
    viewer: { canManage: false },
  });
});

test("a developer cannot turn the team's checks off", async () => {
  const storage = makeStorage({ "teams:team-1": true });
  const handlers = await teamHandlers({ role: "developer", storage });

  const response = await handlers.PATCH(patch({ enabled: false }), teamContext);

  assert.equal(response.status, 403);
  assert.equal(storage.values.get("teams:team-1"), true);
  assert.deepEqual(storage.log.writes, []);
  assert.deepEqual(storage.log.audits, []);
});

test("someone outside the team can neither read nor change it", async () => {
  const storage = makeStorage({ "teams:team-1": true });
  const handlers = await teamHandlers({ role: null, storage });

  const read = await handlers.GET(
    new Request("https://mogplex.test/api"),
    teamContext
  );
  const write = await handlers.PATCH(patch({ enabled: false }), teamContext);

  assert.equal(read.status, 403);
  assert.equal(write.status, 403);
  assert.deepEqual(storage.log.writes, []);
});

test("an admin turning the checks off stores it, clears the cache, and audits the change", async () => {
  const storage = makeStorage({ "teams:team-1": true });
  const handlers = await teamHandlers({ role: "admin", storage });

  const response = await handlers.PATCH(patch({ enabled: false }), teamContext);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    enabled: false,
    viewer: { canManage: true },
  });
  assert.equal(storage.values.get("teams:team-1"), false);
  assert.deepEqual(storage.log.forgotten, ["teams:team-1"]);
  assert.deepEqual(storage.log.audits, [
    { key: "teams:team-1", actorId: "user-1", from: true, to: false },
  ]);
});

test("saving the value it already has writes no audit event", async () => {
  const storage = makeStorage({ "teams:team-1": false });
  const handlers = await teamHandlers({ role: "owner", storage });

  const response = await handlers.PATCH(patch({ enabled: false }), teamContext);

  assert.equal(response.status, 200);
  assert.deepEqual(storage.log.audits, []);
});

test("a failed audit write does not undo or fail the change", async () => {
  const storage = makeStorage({ "teams:team-1": true });
  storage.deps.onChanged = async () => {
    throw new Error("audit insert failed");
  };
  const handlers = await teamHandlers({ role: "owner", storage });

  const response = await handlers.PATCH(patch({ enabled: false }), teamContext);

  assert.equal(response.status, 200);
  assert.equal(storage.values.get("teams:team-1"), false);
});

test("anything but a boolean is rejected before storage is touched", async () => {
  const storage = makeStorage({ "teams:team-1": true });
  const handlers = await teamHandlers({ role: "owner", storage });

  for (const body of [
    { enabled: "false" },
    { enabled: null },
    {},
    [],
    "not json",
  ]) {
    const response = await handlers.PATCH(patch(body), teamContext);
    assert.equal(response.status, 422, JSON.stringify(body));
  }
  assert.deepEqual(storage.log.writes, []);
});

test("a storage failure returns a plain 500 without the database message", async () => {
  const storage = makeStorage({ "teams:team-1": true });
  storage.deps.write = async () => {
    throw new Error('relation "teams" is locked by pid 4242');
  };
  const handlers = await teamHandlers({ role: "owner", storage });

  const response = await handlers.PATCH(patch({ enabled: false }), teamContext);

  assert.equal(response.status, 500);
  assert.doesNotMatch(JSON.stringify(await response.json()), /4242|relation/);
});

test("a signed-out request is turned away by both routes", async () => {
  configureEnv();
  const storage = makeStorage({
    "teams:team-1": true,
    "profiles:user-1": true,
  });
  const team = await teamHandlers({ role: "owner", storage, signedIn: false });
  const { createPersonalDecisionChecksHandlers } =
    await import("../../app/api/settings/decision-checks/route");
  const personal = createPersonalDecisionChecksHandlers({
    ...storage.deps,
    requireProfileId: async () =>
      Response.json({ error: "Unauthorized" }, { status: 401 }),
  });

  assert.equal(
    (await team.PATCH(patch({ enabled: false }), teamContext)).status,
    401
  );
  assert.equal((await personal.GET()).status, 401);
  assert.equal((await personal.PATCH(patch({ enabled: false }))).status, 401);
  assert.deepEqual(storage.log.writes, []);
});

test("a person changes only their own setting, never a team's", async () => {
  configureEnv();
  const storage = makeStorage({
    "teams:team-1": true,
    "profiles:user-1": true,
  });
  const { createPersonalDecisionChecksHandlers } =
    await import("../../app/api/settings/decision-checks/route");
  const personal = createPersonalDecisionChecksHandlers({
    ...storage.deps,
    requireProfileId: async () => "user-1",
  });

  const response = await personal.PATCH(patch({ enabled: false }));
  const read = await personal.GET();

  assert.equal(response.status, 200);
  assert.deepEqual(await read.json(), {
    enabled: false,
    viewer: { canManage: true },
  });
  assert.equal(storage.values.get("profiles:user-1"), false);
  assert.equal(storage.values.get("teams:team-1"), true);
  assert.deepEqual(storage.log.forgotten, ["profiles:user-1"]);
});
