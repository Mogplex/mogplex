"use client";

import { useCallback } from "react";
import type { ToolApprovalResponse } from "./timeline-card";

type AddToolApprovalFn = (options: {
  id: string;
  approved: boolean;
  reason?: string;
}) => void | PromiseLike<void>;

/**
 * Creates a handler for tool approval responses that:
 * 1. Calls addToolApprovalResponse to update UI state and resume the stream
 * 2. Fire-and-forget POSTs to the durable audit log API (best-effort)
 *
 * The durable row is keyed by tool_call_id, not the stream approval id,
 * so we fetch pending approvals to find the matching row.
 */
export function useToolApprovalHandler(
  addToolApprovalResponse: AddToolApprovalFn
) {
  return useCallback(
    async (response: ToolApprovalResponse) => {
      // 1. Update UI state and resume the stream
      await addToolApprovalResponse({
        id: response.approvalId,
        approved: response.approved,
        reason: response.reason,
      });

      // 2. Fire-and-forget POST to durable audit log (best-effort)
      resolveAuditRow(response.toolCallId, response.approved, response.reason);
    },
    [addToolApprovalResponse]
  );
}

/**
 * Best-effort resolution of the durable approval row.
 * Fetches pending approvals to find the matching row by tool_call_id,
 * then POSTs the decision. Silent failure on any error.
 */
async function resolveAuditRow(
  toolCallId: string,
  approved: boolean,
  reason: string | undefined
) {
  try {
    const res = await fetch("/api/control/approvals");
    if (!res.ok) return;
    const data = (await res.json()) as {
      approvals?: Array<{ id: string; tool_call_id: string }>;
    } | null;
    if (!data) return;
    const match = data.approvals?.find((a) => a.tool_call_id === toolCallId);
    if (!match) return;
    await fetch(`/api/control/approvals/${match.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        decision: approved ? "approve" : "deny",
        note: reason,
      }),
    });
  } catch {
    // Silent failure - audit is best-effort
  }
}
