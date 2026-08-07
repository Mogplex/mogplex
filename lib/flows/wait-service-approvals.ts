/**
 * Flow wait approval operations.
 *
 * This module handles pending approval queries and tool approval budget
 * calculations for the approvals API. Covers both mid-run tool-call gates
 * and explicit manual_approval nodes.
 */
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { FlowWait } from "@/lib/types";
import type { ResumeFlowWaitCandidate } from "./wait-service-core";

// Pending human decisions for the approvals API. This covers both mid-run
// tool-call gates and explicit manual_approval nodes. Strictly user-scoped;
// excludes waits whose window already lapsed (the runner finalizes those as
// expired on its own timeout path).
export type PendingFlowApproval = Pick<
  FlowWait,
  | "id"
  | "job_run_id"
  | "flow_id"
  | "node_id"
  | "wait_config"
  | "created_at"
  | "expires_at"
>;
export type PendingToolApproval = PendingFlowApproval;

// Page size for the pending-approvals list. Not a cap on how many approvals
// can exist — hasMore tells the caller when the page is full, so nothing is
// silently truncated. Oldest first, so the requests closest to timing out
// always surface on the first page; resolving them reveals the rest.
const PENDING_TOOL_APPROVALS_PAGE_SIZE = 50;

export async function listPendingToolApprovals(
  userId: string
): Promise<{ approvals: PendingFlowApproval[]; hasMore: boolean }> {
  const { data, error } = await supabaseAdmin
    .from("flow_waits")
    .select(
      "id, job_run_id, flow_id, node_id, wait_config, created_at, expires_at"
    )
    .eq("user_id", userId)
    .in("wait_kind", ["tool_approval", "manual_approval"])
    .eq("status", "waiting")
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .order("created_at", { ascending: true })
    .limit(PENDING_TOOL_APPROVALS_PAGE_SIZE + 1);
  if (error) {
    throw new Error(`Failed to load pending approvals: ${error.message}`);
  }
  const rows = (data ?? []) as PendingFlowApproval[];
  return {
    approvals: rows.slice(0, PENDING_TOOL_APPROVALS_PAGE_SIZE),
    hasMore: rows.length > PENDING_TOOL_APPROVALS_PAGE_SIZE,
  };
}

// Durable accounting for the per-node-run approval wait budget. The budget
// must survive process replacement (Trigger.dev wait tokens checkpoint the
// task and may resume it on a fresh worker), so it is derived from the
// flow_waits rows themselves instead of any in-memory state: a resumed wait
// charges its actual waiting time, and any non-resumed wait (still waiting,
// expired, or cancelled) conservatively charges its full reserved window.
// The reservation model also keeps concurrent tool calls from double-drawing
// the budget once their rows exist.
export async function loadToolApprovalSpentWaitMs(input: {
  jobRunId: string;
  nodeId: string;
}): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from("flow_waits")
    .select("created_at, expires_at, resumed_at")
    .eq("job_run_id", input.jobRunId)
    .eq("node_id", input.nodeId)
    .eq("wait_kind", "tool_approval");
  if (error) {
    throw new Error(`Failed to load approval wait usage: ${error.message}`);
  }

  let spentMs = 0;
  for (const row of data ?? []) {
    const createdAt = Date.parse(row.created_at as string);
    const endAt = Date.parse(
      (row.resumed_at as string | null) ??
        (row.expires_at as string | null) ??
        (row.created_at as string)
    );
    if (Number.isFinite(createdAt) && Number.isFinite(endAt)) {
      spentMs += Math.max(0, endAt - createdAt);
    }
  }
  return spentMs;
}

export type OwnedFlowApprovalWait = ResumeFlowWaitCandidate &
  Pick<FlowWait, "status" | "expires_at">;
export type OwnedToolApprovalWait = OwnedFlowApprovalWait;

const WAIT_ID_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function loadOwnedToolApprovalWait(
  userId: string,
  waitId: string
): Promise<OwnedFlowApprovalWait | null> {
  // Wait ids are UUIDs; a non-UUID selector can never match, and passing it
  // to Postgres would fail the uuid cast instead of returning null.
  if (!WAIT_ID_UUID_PATTERN.test(waitId)) {
    return null;
  }
  const { data, error } = await supabaseAdmin
    .from("flow_waits")
    .select(
      "id, user_id, job_run_id, flow_id, installation_id, repo_id, node_id, wait_kind, wait_config, resume_token, status, expires_at"
    )
    .eq("id", waitId)
    .eq("user_id", userId)
    .in("wait_kind", ["tool_approval", "manual_approval"])
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to load approval wait: ${error.message}`);
  }
  return (data as OwnedFlowApprovalWait | null) ?? null;
}
