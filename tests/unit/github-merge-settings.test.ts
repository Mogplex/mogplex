import assert from "node:assert/strict";
import test from "node:test";
import { NextResponse } from "next/server";
import {
  createMergeSettingsHandlers,
  type MergeSettingsDeps,
} from "../../lib/github-merge-policy-handlers";
import type { TeamMergePolicy } from "../../lib/github-merge-policy";
import type { RecordTeamAuditEventInput } from "../../lib/team-audit";

function fixture(
  input: {
    role?: "owner" | "admin" | "developer";
    denied?: boolean;
    signedOut?: boolean;
  } = {}
) {
  let policy: TeamMergePolicy = {
    requireApproval: false,
    contextRepoOnly: false,
  };
  const audits: RecordTeamAuditEventInput[] = [];
  let writes = 0;
  const resolutions: Parameters<MergeSettingsDeps["resolve"]>[0][] = [];
  const deps: MergeSettingsDeps = {
    requireProfileId: async () =>
      input.signedOut
        ? NextResponse.json({ error: "Unauthorized" }, { status: 401 })
        : "user-1",
    loadTeamMembershipAuth: async () =>
      input.denied
        ? { ok: false, status: 403, error: "Forbidden" }
        : {
            ok: true,
            role: input.role ?? "owner",
            canManage: input.role !== "developer",
          },
    read: async () => policy,
    write: async (_id, next) => {
      policy = { ...policy, ...next };
      writes += 1;
      return true;
    },
    list: async () => [],
    resolve: async (value) => {
      resolutions.push(value);
      return true;
    },
    audit: async (value) => {
      audits.push(value);
      return { ok: true };
    },
    reportAuditFailure: () => undefined,
  };
  return {
    deps,
    audits,
    resolutions,
    get writes() {
      return writes;
    },
    get policy() {
      return policy;
    },
  };
}
function request(body: unknown) {
  return new Request("https://mogplex.test/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

test("members can read defaults but only owner/admin can save and audit both controls", async () => {
  for (const role of ["owner", "admin", "developer"] as const) {
    const state = fixture({ role });
    const handlers = createMergeSettingsHandlers(state.deps);
    const response = await handlers.get("team-1");
    assert.deepEqual(await response.json(), {
      policy: state.policy,
      approvals: [],
      viewer: { canManage: role !== "developer" },
    });
    const policy = { requireApproval: true, contextRepoOnly: true };
    assert.equal(
      (await handlers.patch(request(policy), "team-1")).status,
      role === "developer" ? 403 : 200
    );
    assert.equal(state.writes, role === "developer" ? 0 : 1);
    if (role !== "developer")
      assert.deepEqual(state.audits[0], {
        productTeamId: "team-1",
        actorUserId: "user-1",
        action: "github.merge_policy.changed",
        targetType: "team",
        targetId: "team-1",
        payload: {
          from: { requireApproval: false, contextRepoOnly: false },
          to: policy,
        },
      });
  }
});

test("unauthenticated and outside-team requests cannot read, update, or resolve", async () => {
  for (const denied of [{ signedOut: true }, { denied: true }]) {
    const state = fixture(denied);
    const handlers = createMergeSettingsHandlers(state.deps);
    for (const response of [
      await handlers.get("team-1"),
      await handlers.patch(
        request({ requireApproval: true, contextRepoOnly: true }),
        "team-1"
      ),
      await handlers.resolve(
        request({ approved: true }),
        "team-1",
        "00000000-0000-4000-8000-000000000081"
      ),
    ])
      assert.equal(response.status, denied.signedOut ? 401 : 403);
    assert.equal(state.writes, 0);
    assert.deepEqual(state.resolutions, []);
  }
});

test("rejects malformed bodies and model-supplied approval identities before writing", async () => {
  const state = fixture();
  const handlers = createMergeSettingsHandlers(state.deps);
  for (const body of [
    "not JSON",
    [],
    {},
    { requireApproval: "true", contextRepoOnly: false },
    { requireApproval: true, contextRepoOnly: false, userId: "attacker" },
  ])
    assert.equal((await handlers.patch(request(body), "team-1")).status, 422);
  for (const body of [
    "not JSON",
    {},
    { approved: "true" },
    { approved: true, userId: "attacker" },
  ])
    assert.equal(
      (
        await handlers.resolve(
          request(body),
          "team-1",
          "00000000-0000-4000-8000-000000000081"
        )
      ).status,
      422
    );
  assert.equal(state.writes, 0);
  assert.deepEqual(state.resolutions, []);
});

test("resolution always uses the signed-in member and URL team, and records the decision", async () => {
  const state = fixture({ role: "developer" });
  const handlers = createMergeSettingsHandlers(state.deps);
  assert.equal(
    (
      await handlers.resolve(
        request({ approved: false }),
        "team-1",
        "00000000-0000-4000-8000-000000000081"
      )
    ).status,
    200
  );
  assert.deepEqual(state.resolutions, [
    {
      userId: "user-1",
      teamId: "team-1",
      approvalId: "00000000-0000-4000-8000-000000000081",
      approved: false,
    },
  ]);
  assert.deepEqual(state.audits, [
    {
      productTeamId: "team-1",
      actorUserId: "user-1",
      action: "github.merge_approval.resolved",
      targetType: "merge_approval",
      targetId: "00000000-0000-4000-8000-000000000081",
      payload: { approved: false },
    },
  ]);
  state.deps.resolve = async () => false;
  assert.equal(
    (
      await createMergeSettingsHandlers(state.deps).resolve(
        request({ approved: true }),
        "team-1",
        "00000000-0000-4000-8000-000000000081"
      )
    ).status,
    409
  );
});

test("storage failures return a safe error and never report a saved approval", async () => {
  const state = fixture();
  const fail = async () => {
    throw new Error("private database diagnostic");
  };
  const handlers = createMergeSettingsHandlers({
    ...state.deps,
    read: fail,
    resolve: fail,
  });
  const previous = console.error;
  console.error = () => {};
  try {
    for (const response of [
      await handlers.get("team-1"),
      await handlers.patch(
        request({ requireApproval: true, contextRepoOnly: false }),
        "team-1"
      ),
      await handlers.resolve(
        request({ approved: true }),
        "team-1",
        "00000000-0000-4000-8000-000000000081"
      ),
    ]) {
      assert.equal(response.status, 500);
      assert.ok(
        !(await response.text()).includes("private database diagnostic")
      );
    }
  } finally {
    console.error = previous;
  }
});
test("lost setting and approval audits are surfaced without undoing successful writes", async () => {
  const state = fixture();
  const reports: unknown[] = [];
  const options = {
    ...state.deps,
    audit: async () => ({ ok: false as const, error: "private diagnostic" }),
    reportAuditFailure: (extra: Record<string, unknown>) => {
      reports.push(extra);
    },
  };
  const handlers = createMergeSettingsHandlers(options);
  assert.equal(
    (
      await handlers.patch(
        request({ requireApproval: true, contextRepoOnly: false }),
        "team-1"
      )
    ).status,
    200
  );
  assert.equal(
    (
      await handlers.resolve(
        request({ approved: true }),
        "team-1",
        "00000000-0000-4000-8000-000000000081"
      )
    ).status,
    200
  );
  assert.equal(reports.length, 2);
  assert.ok(!JSON.stringify(reports).includes("private diagnostic"));
});

test("malformed approval IDs are rejected before storage and auditing", async () => {
  const state = fixture();
  const handlers = createMergeSettingsHandlers(state.deps);
  for (const id of [
    "not-a-uuid",
    "",
    "00000000-0000-4000-8000-000000000081extra",
  ]) {
    const response = await handlers.resolve(
      request({ approved: true }),
      "team-1",
      id
    );
    assert.equal(response.status, 422);
    assert.deepEqual(await response.json(), { error: "Invalid approval ID" });
  }
  assert.deepEqual(state.resolutions, []);
  assert.deepEqual(state.audits, []);
});

test("saving one control preserves the other and returns the complete saved policy", async () => {
  const state = fixture();
  const handlers = createMergeSettingsHandlers(state.deps);
  for (const patch of [{ requireApproval: true }, { contextRepoOnly: true }]) {
    const response = await handlers.patch(request(patch), "team-1");
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).policy, state.policy);
  }
  assert.deepEqual(state.policy, {
    requireApproval: true,
    contextRepoOnly: true,
  });
  assert.deepEqual(
    state.audits.map((event) => event.payload),
    [
      { from: { requireApproval: false }, to: { requireApproval: true } },
      { from: { contextRepoOnly: false }, to: { contextRepoOnly: true } },
    ]
  );
  assert.equal(
    (await handlers.patch(request({ requireApproval: false }), "team-1"))
      .status,
    200
  );
  assert.deepEqual(state.policy, {
    requireApproval: false,
    contextRepoOnly: true,
  });
});
