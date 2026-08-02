import assert from "node:assert/strict";
import test from "node:test";
import type {
  OwnedToolApprovalWait,
  PendingToolApproval,
} from "../../lib/flows/wait-service";

async function loadApprovalsRoutes() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  const [list, resolve] = await Promise.all([
    import("../../app/api/flows/approvals/route"),
    import("../../app/api/flows/approvals/[id]/route"),
  ]);
  return { ...list, ...resolve };
}

const WAIT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

function buildWaitingApproval(): OwnedToolApprovalWait {
  return {
    id: WAIT_ID,
    user_id: "user-123",
    job_run_id: "job-run-1",
    flow_id: "flow-1",
    installation_id: 42,
    repo_id: "repo-1",
    node_id: "node-1",
    wait_kind: "tool_approval",
    wait_config: {
      kind: "tool_approval",
      toolName: "updateFile",
      toolCallId: "call-1",
      toolInput: "{}",
      nodeId: "node-1",
      nodeLabel: "Review",
      agentName: "Reviewer",
      repoFullName: "acme/widgets",
    },
    resume_token: "token-1",
    status: "waiting",
    // The route rejects lapsed windows against the real clock, so the
    // fixture must stay in the future.
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
  };
}

function buildManualApproval(): OwnedToolApprovalWait {
  return {
    id: WAIT_ID,
    user_id: "user-123",
    job_run_id: "job-run-1",
    flow_id: "flow-1",
    installation_id: 42,
    repo_id: "repo-1",
    node_id: "await-approval",
    wait_kind: "manual_approval",
    wait_config: {
      kind: "manual_approval",
      prompt: "Approve production deployment",
    },
    resume_token: "token-manual",
    status: "waiting",
    expires_at: null,
  };
}

function buildResolveRequest(body: unknown) {
  return new Request(`https://app.mogplex.com/api/flows/approvals/${WAIT_ID}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const routeParams = { params: Promise.resolve({ id: WAIT_ID }) };

test("GET /api/flows/approvals returns the caller's pending approvals", async () => {
  const { createFlowApprovalsGetHandler } = await loadApprovalsRoutes();
  const calls: string[] = [];
  const pending: PendingToolApproval[] = [
    {
      id: WAIT_ID,
      job_run_id: "job-run-1",
      flow_id: "flow-1",
      node_id: "node-1",
      wait_config: buildWaitingApproval().wait_config,
      created_at: "2026-07-22T12:00:00.000Z",
      expires_at: "2026-07-22T12:10:00.000Z",
    },
  ];

  const handler = createFlowApprovalsGetHandler({
    requireUserId: async () => "user-123",
    listPendingToolApprovals: async (userId) => {
      calls.push(userId);
      return { approvals: pending, hasMore: true };
    },
  });

  const response = await handler();
  assert.equal(response.status, 200);
  // hasMore must reach the client so a full page is never mistaken for the
  // complete set.
  assert.deepEqual(await response.json(), {
    approvals: pending,
    hasMore: true,
  });
  assert.deepEqual(calls, ["user-123"]);
});

test("POST approve resolves the wait with a decision payload", async () => {
  const { createFlowApprovalResolvePostHandler } = await loadApprovalsRoutes();
  const resumeCalls: Array<Record<string, unknown>> = [];

  const handler = createFlowApprovalResolvePostHandler({
    requireUserId: async () => "user-123",
    loadOwnedToolApprovalWait: async () => buildWaitingApproval(),
    resumeFlowWait: async (input) => {
      resumeCalls.push(input as unknown as Record<string, unknown>);
      return { resumed: true, resumeToken: "token-1" };
    },
  });

  const response = await handler(
    buildResolveRequest({ decision: "approve", note: "  focus on src/  " }),
    routeParams
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, decision: "approve" });
  assert.equal(resumeCalls.length, 1);
  const payload = resumeCalls[0].payload as Record<string, unknown>;
  assert.equal(payload.decision, "approve");
  assert.equal(payload.note, "focus on src/");
  assert.equal(payload.decided_by, "user-123");
  assert.equal(resumeCalls[0].deliveryId, null);
  // The CAS must enforce the deadline atomically, not just the route check.
  assert.equal(typeof resumeCalls[0].notExpiredAt, "string");
});

test("POST resolves a manual approval with no timeout", async () => {
  const { createFlowApprovalResolvePostHandler } = await loadApprovalsRoutes();
  const resumeInputs: Array<Record<string, unknown>> = [];
  const handler = createFlowApprovalResolvePostHandler({
    requireUserId: async () => "user-123",
    loadOwnedToolApprovalWait: async () => buildManualApproval(),
    resumeFlowWait: async (input) => {
      resumeInputs.push(input as unknown as Record<string, unknown>);
      return { resumed: true, resumeToken: "token-manual" };
    },
  });

  const response = await handler(
    buildResolveRequest({ decision: "approve" }),
    routeParams
  );

  assert.equal(response.status, 200);
  assert.equal(resumeInputs[0]?.notExpiredAt, undefined);
  assert.equal(
    (resumeInputs[0]?.payload as Record<string, unknown>).decision,
    "approve"
  );
});

test("POST returns 409 for a wait whose window lapsed before the runner finalized it", async () => {
  const { createFlowApprovalResolvePostHandler } = await loadApprovalsRoutes();
  const handler = createFlowApprovalResolvePostHandler({
    requireUserId: async () => "user-123",
    loadOwnedToolApprovalWait: async () => ({
      ...buildWaitingApproval(),
      // Still `waiting` in the table, but the promised window has passed.
      expires_at: new Date(Date.now() - 1_000).toISOString(),
    }),
    resumeFlowWait: async () => {
      throw new Error("must not resume an expired wait");
    },
  });

  const response = await handler(
    buildResolveRequest({ decision: "approve" }),
    routeParams
  );
  assert.equal(response.status, 409);
});

test("POST rejects invalid decisions and oversized notes", async () => {
  const { createFlowApprovalResolvePostHandler } = await loadApprovalsRoutes();
  const handler = createFlowApprovalResolvePostHandler({
    requireUserId: async () => "user-123",
    loadOwnedToolApprovalWait: async () => {
      throw new Error("must not load the wait for an invalid body");
    },
    resumeFlowWait: async () => {
      throw new Error("must not resume for an invalid body");
    },
  });

  const invalidDecision = await handler(
    buildResolveRequest({ decision: "maybe" }),
    routeParams
  );
  assert.equal(invalidDecision.status, 400);

  const oversizedNote = await handler(
    buildResolveRequest({ decision: "deny", note: "x".repeat(2_001) }),
    routeParams
  );
  assert.equal(oversizedNote.status, 400);
});

test("POST returns 404 for a wait the caller does not own", async () => {
  const { createFlowApprovalResolvePostHandler } = await loadApprovalsRoutes();
  const handler = createFlowApprovalResolvePostHandler({
    requireUserId: async () => "user-123",
    loadOwnedToolApprovalWait: async () => null,
    resumeFlowWait: async () => {
      throw new Error("must not resume a wait that failed ownership");
    },
  });

  const response = await handler(
    buildResolveRequest({ decision: "approve" }),
    routeParams
  );
  assert.equal(response.status, 404);
});

test("POST returns 409 when the wait is no longer pending or loses the resume race", async () => {
  const { createFlowApprovalResolvePostHandler } = await loadApprovalsRoutes();

  const alreadyResolved = createFlowApprovalResolvePostHandler({
    requireUserId: async () => "user-123",
    loadOwnedToolApprovalWait: async () => ({
      ...buildWaitingApproval(),
      status: "resumed" as const,
    }),
    resumeFlowWait: async () => {
      throw new Error("must not resume a non-waiting wait");
    },
  });
  const staleResponse = await alreadyResolved(
    buildResolveRequest({ decision: "approve" }),
    routeParams
  );
  assert.equal(staleResponse.status, 409);

  const lostRace = createFlowApprovalResolvePostHandler({
    requireUserId: async () => "user-123",
    loadOwnedToolApprovalWait: async () => buildWaitingApproval(),
    resumeFlowWait: async () => ({
      resumed: false,
      reason: "already_resumed" as const,
    }),
  });
  const raceResponse = await lostRace(
    buildResolveRequest({ decision: "deny" }),
    routeParams
  );
  assert.equal(raceResponse.status, 409);
});

test("GET hides database error detail behind a generic message", async () => {
  const { createFlowApprovalsGetHandler } = await loadApprovalsRoutes();
  const handler = createFlowApprovalsGetHandler({
    requireUserId: async () => "user-123",
    listPendingToolApprovals: async () => {
      throw new Error(
        'relation "flow_waits" violates constraint flow_waits_status_check'
      );
    },
  });

  const response = await handler();
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: "Failed to load approvals",
  });
});

test("POST hides wait-provider error detail behind a generic message on complete_failed", async () => {
  const { createFlowApprovalResolvePostHandler } = await loadApprovalsRoutes();
  const handler = createFlowApprovalResolvePostHandler({
    requireUserId: async () => "user-123",
    loadOwnedToolApprovalWait: async () => buildWaitingApproval(),
    resumeFlowWait: async () => ({
      resumed: false,
      reason: "complete_failed" as const,
      message: "trigger.dev token wt_abc123 failed: internal worker detail",
    }),
  });

  const response = await handler(
    buildResolveRequest({ decision: "approve" }),
    routeParams
  );
  assert.equal(response.status, 502);
  const body = (await response.json()) as { error: string };
  assert.equal(body.error, "Failed to deliver the decision; try again");
  assert.ok(!body.error.includes("wt_abc123"));
});
