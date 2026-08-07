import assert from "node:assert/strict";
import test from "node:test";
import type { ControlApprovalRow } from "../../lib/control/approvals-store";

async function loadApprovalsRoutes() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  const [list, resolve] = await Promise.all([
    import("../../app/api/control/approvals/route"),
    import("../../app/api/control/approvals/[id]/route"),
  ]);
  return { ...list, ...resolve };
}

const APPROVAL_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

function buildApproval(): ControlApprovalRow {
  return {
    id: APPROVAL_ID,
    user_id: "user-123",
    run_id: null,
    ai_call_id: "call-1",
    tool_name: "delete_file",
    tool_call_id: "tc-1",
    tool_input: { path: "lib/old.ts" },
    summary: "The delete_file action requires operator approval.",
    urgency: "normal",
    status: "pending",
    resolution_source: null,
    expires_at: null,
    resolved_at: null,
    resolved_by: null,
    resolution_note: null,
    created_at: new Date().toISOString(),
  };
}

function buildResolveRequest(body: unknown) {
  return new Request(
    `https://app.mogplex.com/api/control/approvals/${APPROVAL_ID}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

const routeParams = { params: Promise.resolve({ id: APPROVAL_ID }) };

test("GET /api/control/approvals returns the caller's pending approvals", async () => {
  const { createControlApprovalsGetHandler } = await loadApprovalsRoutes();
  const seen: Array<{ userId: string; runId: string | null }> = [];
  const handler = createControlApprovalsGetHandler({
    requireUserId: async () => "user-123",
    listPendingControlApprovals: async (input) => {
      seen.push({ userId: input.userId, runId: input.runId ?? null });
      return [buildApproval()];
    },
  });
  const response = await handler(
    new Request("https://app.mogplex.com/api/control/approvals?runId=run-9")
  );
  assert.equal(response.status, 200);
  const body = (await response.json()) as { approvals: ControlApprovalRow[] };
  assert.equal(body.approvals.length, 1);
  assert.equal(body.approvals[0].id, APPROVAL_ID);
  assert.deepEqual(seen, [{ userId: "user-123", runId: "run-9" }]);
});

test("POST resolve approves with a note and reports the decision", async () => {
  const { createControlApprovalResolvePostHandler } =
    await loadApprovalsRoutes();
  const resolved: Array<Record<string, unknown>> = [];
  const handler = createControlApprovalResolvePostHandler({
    requireUserId: async () => "user-123",
    resolveControlApproval: async (input) => {
      resolved.push(input as unknown as Record<string, unknown>);
      return true;
    },
  });
  const response = await handler(
    buildResolveRequest({ decision: "approve", note: "  ship it  " }),
    routeParams
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, decision: "approved" });
  assert.partialDeepStrictEqual(resolved[0], {
    approvalId: APPROVAL_ID,
    userId: "user-123",
    decision: "approved",
    source: "api",
    note: "ship it",
  });
});

test("POST resolve returns 409 when the approval is no longer pending", async () => {
  const { createControlApprovalResolvePostHandler } =
    await loadApprovalsRoutes();
  const handler = createControlApprovalResolvePostHandler({
    requireUserId: async () => "user-123",
    resolveControlApproval: async () => false,
  });
  const response = await handler(
    buildResolveRequest({ decision: "deny" }),
    routeParams
  );
  assert.equal(response.status, 409);
});

test("POST resolve rejects malformed decisions", async () => {
  const { createControlApprovalResolvePostHandler } =
    await loadApprovalsRoutes();
  const handler = createControlApprovalResolvePostHandler({
    requireUserId: async () => "user-123",
    resolveControlApproval: async () => {
      throw new Error("must not be called");
    },
  });
  const response = await handler(
    buildResolveRequest({ decision: "maybe" }),
    routeParams
  );
  assert.equal(response.status, 400);
});
