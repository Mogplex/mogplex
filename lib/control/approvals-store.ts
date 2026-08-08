import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Data access for control-plane approvals. Rows are written by the
 * orchestrator's policy gate (AI SDK needsApproval) and the request_approval
 * tool; resolved in-stream by the control UI or via the approvals API.
 * Resolution is atomic (resolve_control_approval RPC) — double-resolves and
 * post-expiry approvals report false instead of overwriting.
 */

export type ControlApprovalStatus =
  | "pending"
  | "approved"
  | "denied"
  | "expired"
  | "cancelled";

export type ControlApprovalRow = {
  id: string;
  user_id: string;
  run_id: string | null;
  ai_call_id: string | null;
  tool_name: string;
  tool_call_id: string;
  tool_input: Record<string, unknown>;
  summary: string;
  urgency: "low" | "normal" | "high";
  status: ControlApprovalStatus;
  resolution_source: "in_stream" | "api" | "auto" | "system" | null;
  expires_at: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_note: string | null;
  created_at: string;
};

export class ControlApprovalsStoreError extends Error {
  constructor(operation: string, cause: string) {
    super(`control approvals ${operation} failed: ${cause}`);
    this.name = "ControlApprovalsStoreError";
  }
}

const TABLE = "control_approvals";

export type CreateControlApprovalInput = {
  userId: string;
  toolName: string;
  toolCallId: string;
  toolInput: Record<string, unknown>;
  summary: string;
  urgency?: "low" | "normal" | "high";
  runId?: string | null;
  aiCallId?: string | null;
  expiresAt?: string | null;
};

export async function createControlApproval(
  input: CreateControlApprovalInput
): Promise<ControlApprovalRow> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .insert({
      user_id: input.userId,
      run_id: input.runId ?? null,
      ai_call_id: input.aiCallId ?? null,
      tool_name: input.toolName,
      tool_call_id: input.toolCallId,
      tool_input: input.toolInput,
      summary: input.summary,
      urgency: input.urgency ?? "normal",
      expires_at: input.expiresAt ?? null,
    })
    .select("*")
    .single();
  if (error || !data) {
    throw new ControlApprovalsStoreError(
      "create",
      error?.message ?? "no row returned"
    );
  }
  return data as unknown as ControlApprovalRow;
}

export async function listPendingControlApprovals(input: {
  userId: string;
  runId?: string | null;
  limit?: number;
}): Promise<ControlApprovalRow[]> {
  let query = supabaseAdmin
    .from(TABLE)
    .select("*")
    .eq("user_id", input.userId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(input.limit ?? 50);
  if (input.runId) query = query.eq("run_id", input.runId);
  const { data, error } = await query;
  if (error) {
    throw new ControlApprovalsStoreError("list pending", error.message);
  }
  return (data ?? []) as unknown as ControlApprovalRow[];
}

export async function getControlApprovalByToolCallId(input: {
  userId: string;
  toolCallId: string;
}): Promise<ControlApprovalRow | null> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("*")
    .eq("user_id", input.userId)
    .eq("tool_call_id", input.toolCallId)
    .eq("status", "pending")
    .maybeSingle();
  if (error) {
    throw new ControlApprovalsStoreError("get by tool call", error.message);
  }
  return (data as unknown as ControlApprovalRow) ?? null;
}

export async function resolveControlApproval(input: {
  approvalId: string;
  userId: string;
  decision: "approved" | "denied" | "expired" | "cancelled";
  source: "in_stream" | "api" | "auto" | "system";
  note?: string | null;
}): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc("resolve_control_approval", {
    p_approval_id: input.approvalId,
    p_user_id: input.userId,
    p_decision: input.decision,
    p_source: input.source,
    p_note: input.note ?? null,
  });
  if (error) {
    throw new ControlApprovalsStoreError("resolve", error.message);
  }
  return data === true;
}
