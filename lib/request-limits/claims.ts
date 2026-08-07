// Atomic claim logic for request rate limiting.
// These functions handle provisioning and releasing limit admission claims
// via database RPCs for atomicity.

import { supabaseAdmin } from "@/lib/supabase/admin";
import { denied } from "./policy";
import type { LimitDecision } from "./types";

// Only provisional/admission claims with a refund path belong here.
// External agent runs are atomically admitted too, but their start quota is
// intentionally non-refundable once a run request has been accepted.
export type AtomicLimitClaimRouteKey = "chat" | "sandbox_boot";

export type LimitRpcResponse = {
  data: unknown;
  error: { message: string } | null;
};

export type LimitRpc = (
  fn: string,
  args?: Record<string, unknown>
) => Promise<LimitRpcResponse>;

type AtomicLimitClaimResultRow = {
  allowed: boolean | null;
  claim_id: string | null;
  code: string | null;
  error: string | null;
  reason: string | null;
  retry_after_seconds: number | null;
  limit_name: string | null;
  limit_value: number | null;
  window_seconds: number | null;
};

function mapAtomicLimitClaimResult(
  fnName: string,
  row: AtomicLimitClaimResultRow | null | undefined
): LimitDecision {
  if (!row) {
    throw new Error(`${fnName} returned no rows`);
  }

  if (row.allowed) {
    if (!row.claim_id) {
      throw new Error(
        `${fnName} returned an allowed decision without a claim_id`
      );
    }

    return {
      allowed: true,
      claimId: row.claim_id,
    };
  }

  if (
    !row.code ||
    !row.error ||
    !row.reason ||
    row.retry_after_seconds == null ||
    !row.limit_name ||
    row.limit_value == null ||
    row.window_seconds == null
  ) {
    throw new Error(`${fnName} returned an invalid denied decision`);
  }

  return denied({
    code: row.code,
    error: row.error,
    reason: row.reason,
    retryAfterSeconds: row.retry_after_seconds,
    limit: {
      name: row.limit_name,
      value: row.limit_value,
      windowSeconds: row.window_seconds,
    },
  });
}

export async function claimAtomicLimitDecision(
  fnName:
    | "claim_chat_limit_admission"
    | "claim_sandbox_boot_limit_admission"
    // Non-refundable: intentionally not in AtomicLimitClaimRouteKey.
    | "claim_external_agent_run_limit_admission",
  args: Record<string, unknown>,
  rpc: LimitRpc = async (fn, rpcArgs) => {
    const { data, error } = await supabaseAdmin.rpc(fn, rpcArgs);
    return {
      data,
      error: error ? { message: error.message } : null,
    };
  }
) {
  const { data, error } = await rpc(fnName, args);

  if (error) {
    throw new Error(`Failed to execute ${fnName}: ${error.message}`);
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | AtomicLimitClaimResultRow
    | null
    | undefined;
  return mapAtomicLimitClaimResult(fnName, row);
}

export async function releaseLimitClaim(input: {
  userId: string;
  routeKey: AtomicLimitClaimRouteKey;
  claimId: string;
}): Promise<boolean> {
  try {
    const { error } = await supabaseAdmin
      .from("limit_events")
      .delete()
      .eq("user_id", input.userId)
      .eq("route_key", input.routeKey)
      .eq("decision", "allowed")
      .eq("claim_id", input.claimId);

    if (error) {
      console.error("[limits] failed to release limit claim", { input, error });
      return false;
    }
    return true;
  } catch (error) {
    console.error("[limits] failed to release limit claim", { input, error });
    return false;
  }
}
