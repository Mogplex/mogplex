import assert from "node:assert/strict";
import test from "node:test";

async function loadTeamAudit() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../lib/team-audit");
}

test("sanitizeTeamAuditPayload redacts unsafe nested fields", async () => {
  const { sanitizeTeamAuditPayload } = await loadTeamAudit();

  assert.deepEqual(
    sanitizeTeamAuditPayload({
      provider: "openai",
      token: "invite-token",
      nested: {
        apiKey: "sk-secret",
        prompt: "raw user prompt",
        model: "openai/gpt-5",
      },
      list: [{ password: "pw", role: "admin" }],
    }),
    {
      provider: "openai",
      token: "[redacted]",
      nested: {
        apiKey: "[redacted]",
        prompt: "[redacted]",
        model: "openai/gpt-5",
      },
      list: [{ password: "[redacted]", role: "admin" }],
    }
  );
});

test("recordTeamAuditEvent resolves actor member and inserts sanitized row", async () => {
  const { createRecordTeamAuditEvent } = await loadTeamAudit();
  const rows: unknown[] = [];

  const recordTeamAuditEvent = createRecordTeamAuditEvent({
    loadActorMemberId: async (teamId, actorUserId) => {
      assert.equal(teamId, "team-1");
      assert.equal(actorUserId, "user-1");
      return "member-1";
    },
    insertAuditEvent: async (row) => {
      rows.push(row);
      return { error: null };
    },
    logError: () => {
      throw new Error("logError should not run");
    },
  });

  const result = await recordTeamAuditEvent({
    productTeamId: "team-1",
    actorUserId: "user-1",
    action: "invite.created",
    targetType: "invite",
    targetId: "invite-1",
    correlations: { repoId: "repo-1", requestId: "req-1" },
    payload: { email: "teammate@example.com", token: "secret-token" },
  });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(rows, [
    {
      team_id: "team-1",
      actor_user_id: "user-1",
      actor_member_id: "member-1",
      action: "invite.created",
      decision_code: null,
      target_type: "invite",
      target_id: "invite-1",
      repo_id: "repo-1",
      sandbox_record_id: null,
      ai_call_id: null,
      job_run_id: null,
      request_id: "req-1",
      auth_source: null,
      payload: {
        email: "teammate@example.com",
        token: "[redacted]",
      },
    },
  ]);
});

test("deferTeamAuditEvent logs unexpected rejected audit writes", async () => {
  const { deferTeamAuditEvent } = await loadTeamAudit();
  const originalError = console.error;
  const logged: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    logged.push(args);
  };

  try {
    deferTeamAuditEvent(
      async () => {
        throw new Error("audit queue failed");
      },
      {
        productTeamId: "team-1",
        action: "sandbox.denied",
        targetType: "sandbox",
      }
    );
    await Promise.resolve();
    await Promise.resolve();
  } finally {
    console.error = originalError;
  }

  assert.equal(logged.length, 1);
  assert.equal(
    logged[0]?.[0],
    "[team-audit] unexpected deferred audit failure"
  );
  assert.match(String(logged[0]?.[1]), /audit queue failed/);
});
