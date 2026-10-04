import assert from "node:assert/strict";
import test from "node:test";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createBulkInvitePostHandler } from "../../app/api/teams/[teamId]/invites/bulk/route";
import {
  MAX_BULK_INVITE_EMAILS,
  type BulkInviteResponse,
} from "../../lib/team-bulk-invite";
import type { TeamRole } from "../../lib/team-capabilities";
import type { RecordTeamAuditEventInput } from "../../lib/team-audit";
import type { sendTeamInvite } from "../../lib/email/send-team-invite";

const context = () => ({ params: Promise.resolve({ teamId: "team-1" }) });
const request = (body: unknown) =>
  new Request("http://localhost/api/teams/team-1/invites/bulk", {
    method: "POST",
    body: JSON.stringify(body),
  });
type Delivery = Parameters<typeof sendTeamInvite>[0];
type Options = {
  actor?: TeamRole;
  failLookup?: "profiles" | "team_members";
  missingTeam?: boolean;
  failInsert?: boolean;
  failDelivery?: boolean;
};

function fixture(options: Options = {}) {
  const writes: Record<string, unknown>[] = [];
  const reads: string[] = [];
  const deliveries: Delivery[] = [];
  const audits: RecordTeamAuditEventInput[] = [];
  const db = createClient("https://database.example", "unit-test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input, init) => {
        const url = new URL(String(input));
        const table = url.pathname.split("/").at(-1);
        if (init?.method === "POST") {
          assert.equal(table, "team_invites");
          const body = JSON.parse(String(init.body)) as Record<string, unknown>;
          writes.push(body);
          if (options.failInsert)
            return Response.json(
              { message: "Insert failed", code: "XX000" },
              { status: 500 }
            );
          return Response.json(
            { id: `invite-${writes.length}` },
            { status: 201 }
          );
        }
        reads.push(`${table}:${url.search}`);
        if (table === options.failLookup)
          return Response.json(
            { message: "Lookup failed", code: "XX000" },
            { status: 500 }
          );
        if (table === "profiles" && url.searchParams.has("email"))
          return Response.json([
            { id: "member-1", email: "member@example.com" },
          ]);
        if (table === "team_members") {
          assert.equal(url.searchParams.get("team_id"), "eq.team-1");
          return Response.json([{ user_id: "member-1" }]);
        }
        if (table === "teams")
          return options.missingTeam
            ? Response.json(
                { message: "No rows", code: "PGRST116" },
                { status: 406 }
              )
            : Response.json({
                id: "team-1",
                name: "Test team",
                slug: "test-team",
              });
        if (table === "profiles")
          return Response.json({ name: "Test inviter", username: "tester" });
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
    generateInviteToken: () => "unit-test-token",
    sendTeamInvite: async (input: Delivery) => {
      deliveries.push(input);
      return options.failDelivery
        ? { ok: false as const, reason: "resend_error" as const }
        : { ok: true as const, channel: "resend" as const };
    },
    recordTeamAuditEvent: async (input: RecordTeamAuditEventInput) => {
      audits.push(input);
      return { ok: true as const };
    },
  };
  return {
    deps,
    handler: createBulkInvitePostHandler(deps),
    writes,
    reads,
    deliveries,
    audits,
  };
}

for (const role of ["admin", "developer", "viewer"] as const) {
  test(`bulk invite normalizes and partitions entries for ${role}`, async () => {
    const f = fixture();
    const response = await f.handler(
      request({
        emails: [
          " PERSON@Example.COM ",
          "person@example.com",
          "member@example.com",
          "bad",
          42,
          null,
        ],
        role,
        team_id: "other-team",
      }),
      context()
    );
    assert.equal(response.status, 200);
    const result = (await response.json()) as BulkInviteResponse;
    assert.deepEqual(result.results, [
      { email: "person@example.com", status: "skipped_duplicate" },
      { email: "bad", status: "skipped_invalid" },
      { email: "42", status: "skipped_invalid" },
      { email: "", status: "skipped_invalid" },
      { email: "member@example.com", status: "skipped_member" },
      { email: "person@example.com", status: "invited", invite_id: "invite-1" },
    ]);
    assert.deepEqual(result.summary, {
      total_requested: 6,
      invited: 1,
      skipped_member: 1,
      skipped_invalid: 3,
      skipped_duplicate: 1,
      delivery_failed: 0,
      insert_failed: 0,
    });
    assert.deepEqual(f.writes, [
      {
        team_id: "team-1",
        email: "person@example.com",
        role,
        token: "unit-test-token",
        invited_by_user_id: "user-1",
      },
    ]);
    assert.deepEqual(f.deliveries, [
      {
        email: "person@example.com",
        teamName: "Test team",
        inviterName: "Test inviter",
        role,
        token: "unit-test-token",
      },
    ]);
    assert.equal(f.audits[0]?.action, "invite.bulk_created");
    assert.deepEqual(f.audits[0]?.payload, { role, ...result.summary });
  });
}

for (const body of [
  null,
  [],
  false,
  "emails",
  {},
  { role: "viewer" },
  { emails: "person@example.com", role: "viewer" },
  { emails: [], role: "viewer" },
  { emails: ["person@example.com"], role: "owner" },
  { emails: ["person@example.com"], role: null },
  {
    emails: Array.from(
      { length: MAX_BULK_INVITE_EMAILS + 1 },
      () => "person@example.com"
    ),
    role: "viewer",
  },
]) {
  test(`bulk invite rejects invalid request ${JSON.stringify(body).slice(0, 70)} with flattened errors`, async () => {
    const f = fixture();
    const response = await f.handler(request(body), context());
    assert.equal(response.status, 400);
    const result = await response.json();
    assert.equal(result.error, "Invalid bulk invite.");
    assert.ok(Array.isArray(result.details.formErrors));
    assert.ok(
      result.details.formErrors.length > 0 ||
        Object.values(result.details.fieldErrors).some(
          (errors) => Array.isArray(errors) && errors.length > 0
        )
    );
    assert.deepEqual(f.reads, []);
    assert.deepEqual(f.writes, []);
    assert.deepEqual(f.deliveries, []);
    assert.deepEqual(f.audits, []);
  });
}

test("bulk invite keeps malformed JSON at 400", async () => {
  const f = fixture();
  const response = await f.handler(
    new Request("http://localhost", { method: "POST", body: "{" }),
    context()
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Invalid JSON body" });
  assert.deepEqual(f.reads, []);
});

test("bulk invite requires sign-in before membership or validation", async () => {
  const f = fixture();
  const handler = createBulkInvitePostHandler({
    ...f.deps,
    requireProfileId: async () =>
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    loadTeamMembershipAuth: async () => {
      throw new Error("Unsigned lookup");
    },
  });
  assert.equal((await handler(request(null), context())).status, 401);
  assert.deepEqual(f.writes, []);
});

for (const actor of ["developer", "viewer"] as const) {
  test(`bulk invite rejects ${actor} before parsing`, async () => {
    const f = fixture({ actor });
    assert.equal((await f.handler(request(null), context())).status, 403);
    assert.deepEqual(f.reads, []);
    assert.deepEqual(f.writes, []);
  });
}

test("bulk invite rejects nonmembers before parsing", async () => {
  const f = fixture();
  const handler = createBulkInvitePostHandler({
    ...f.deps,
    loadTeamMembershipAuth: async () => ({
      ok: false,
      status: 403,
      error: "Forbidden",
    }),
  });
  assert.equal((await handler(request(null), context())).status, 403);
  assert.deepEqual(f.reads, []);
});

test("bulk invite prevents admins from granting admin", async () => {
  const f = fixture({ actor: "admin" });
  assert.equal(
    (
      await f.handler(
        request({ emails: ["person@example.com"], role: "admin" }),
        context()
      )
    ).status,
    403
  );
  assert.deepEqual(f.writes, []);
});

test("bulk invite permits admins to invite developers", async () => {
  const f = fixture({ actor: "admin" });
  assert.equal(
    (
      await f.handler(
        request({ emails: ["person@example.com"], role: "developer" }),
        context()
      )
    ).status,
    200
  );
  assert.equal(f.writes.length, 1);
});

for (const failLookup of ["profiles", "team_members"] as const) {
  test(`bulk invite reports ${failLookup} failure before side effects`, async () => {
    const f = fixture({ failLookup });
    assert.equal(
      (
        await f.handler(
          request({ emails: ["member@example.com"], role: "viewer" }),
          context()
        )
      ).status,
      500
    );
    assert.deepEqual(f.writes, []);
    assert.deepEqual(f.deliveries, []);
    assert.deepEqual(f.audits, []);
  });
}

test("bulk invite reports missing team before writes", async () => {
  const f = fixture({ missingTeam: true });
  assert.equal(
    (
      await f.handler(
        request({ emails: ["person@example.com"], role: "viewer" }),
        context()
      )
    ).status,
    404
  );
  assert.deepEqual(f.writes, []);
});

for (const [options, status] of [
  [{ failInsert: true }, "insert_failed"],
  [{ failDelivery: true }, "delivery_failed"],
] as const) {
  test(`bulk invite retains per-address ${status} outcomes`, async () => {
    const f = fixture(options);
    const response = await f.handler(
      request({ emails: ["person@example.com"], role: "viewer" }),
      context()
    );
    assert.equal(response.status, 200);
    const result = (await response.json()) as BulkInviteResponse;
    assert.equal(result.results[0]?.status, status);
    assert.equal(result.summary[status], 1);
    assert.equal(f.writes.length, 1);
    assert.equal(f.deliveries.length, options.failInsert ? 0 : 1);
    assert.equal(f.audits.length, 1);
  });
}

test("bulk invite accepts the existing maximum and reports all invalid addresses without writes", async () => {
  const f = fixture();
  const response = await f.handler(
    request({
      emails: Array.from({ length: MAX_BULK_INVITE_EMAILS }, () => "bad"),
      role: "viewer",
    }),
    context()
  );
  assert.equal(response.status, 200);
  const result = (await response.json()) as BulkInviteResponse;
  assert.equal(result.summary.skipped_invalid, MAX_BULK_INVITE_EMAILS);
  assert.equal(result.summary.total_requested, MAX_BULK_INVITE_EMAILS);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.deliveries, []);
});
