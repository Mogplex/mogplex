/**
 * Core flow wait types and functions.
 *
 * This module contains the shared types and core functions used by both
 * wait-service.ts and wait-service-routing.ts. Extracting these prevents
 * circular dependencies.
 */
import { wait } from "@trigger.dev/sdk/v3";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type {
  FlowAwaitEventConfig,
  FlowAwaitEventKind,
  FlowStartFilter,
  FlowWait,
} from "@/lib/types";
import { coerceGraph, getStartConfig } from "./graph";
import type {
  FlowOperatorWaitProvider,
  FlowOperatorWaitStore,
} from "./operators/types";

// Default wait provider, backed by Trigger.dev's wait token API. The operator
// modules use this through the registry execution context, never directly.
export const triggerWaitProvider: FlowOperatorWaitProvider = {
  sleep: async ({ untilDate }) => {
    await wait.until({ date: untilDate });
  },
  createToken: async ({ idempotencyKey, timeoutMs }) => {
    const token = await wait.createToken({
      idempotencyKey,
      timeout: timeoutMs
        ? `${Math.max(1, Math.round(timeoutMs))}ms`
        : undefined,
    });
    return { id: token.id };
  },
  waitForToken: async <T>({ tokenId }: { tokenId: string }) => {
    try {
      const result = await wait.forToken<T>(tokenId);
      // Trigger.dev's wait.forToken returns either the output directly or a
      // result envelope depending on SDK minor version; normalize both shapes
      // into our discriminated outcome before handing back to the operator.
      if (result && typeof result === "object" && "ok" in (result as object)) {
        const envelope = result as {
          ok: boolean;
          output?: T;
          error?: { message?: string };
        };
        if (envelope.ok) {
          return { ok: true, output: envelope.output as T };
        }
        return {
          ok: false,
          reason: "timeout",
          message: envelope.error?.message ?? "Wait token did not complete",
        };
      }
      return { ok: true, output: result as T };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Wait token did not complete";
      return { ok: false, reason: "timeout", message };
    }
  },
};

// Default wait store, backed by Supabase. The store is intentionally narrow
// (create + finalize only) so the resume entry point can manage its own CAS
// transition without sharing a writer with the operator module.
export const supabaseWaitStore: FlowOperatorWaitStore = {
  createWait: async (input) => {
    const { data, error } = await supabaseAdmin
      .from("flow_waits")
      .insert({
        user_id: input.userId,
        job_run_id: input.jobRunId,
        flow_id: input.flowId,
        flow_version_id: input.flowVersionId,
        installation_id: input.installationId,
        repo_id: input.repoId,
        node_id: input.nodeId,
        wait_kind: input.waitKind,
        wait_config: input.waitConfig,
        resume_token: input.resumeToken,
        status: "waiting",
        expires_at: input.expiresAt?.toISOString() ?? null,
      })
      .select("id")
      .single();
    if (error || !data) {
      throw new Error(
        `Failed to persist flow wait: ${error?.message ?? "unknown error"}`
      );
    }
    return { id: data.id };
  },
  finalizeWait: async ({ waitId, status }) => {
    const { error } = await supabaseAdmin
      .from("flow_waits")
      .update({
        status,
        resumed_at: status === "resumed" ? new Date().toISOString() : null,
      })
      .eq("id", waitId)
      .eq("status", "waiting");
    // Best-effort: re-finalizing an already-resumed wait is fine. The operator
    // calls this from inside its own success/timeout paths so a duplicate is
    // impossible in practice.
    if (error) {
      console.error("[flow-wait] failed to finalize wait", {
        waitId,
        status,
        error: error.message,
      });
    }
  },
};

export type ResumeFlowWaitCandidate = Pick<
  FlowWait,
  | "id"
  | "user_id"
  | "job_run_id"
  | "flow_id"
  | "installation_id"
  | "repo_id"
  | "node_id"
  | "wait_kind"
  | "wait_config"
  | "resume_token"
>;

export type ResumeFlowWaitInput = {
  candidate: ResumeFlowWaitCandidate;
  payload: Record<string, unknown>;
  deliveryId: string | null;
  // When set, the CAS additionally requires expires_at > this timestamp, so a
  // wait whose promised deadline has already passed can never be resumed even
  // if the runner has not finalized it as expired yet. Used by tool-approval
  // resolution; webhook-resumed waits may have no expires_at and skip this.
  notExpiredAt?: string;
};

export type ResumeFlowWaitOutcome =
  | { resumed: true; resumeToken: string }
  | {
      resumed: false;
      reason: "already_resumed" | "complete_failed";
      message?: string;
      // True when wait.completeToken failed AND the rollback UPDATE also
      // failed. The wait row is left stuck in `resumed` and the next delivery
      // will see `already_resumed` — caller should log loudly so an operator
      // can manually re-open the wait.
      rollbackFailed?: boolean;
    };

// CAS-style resume: the UPDATE only succeeds when the row is still in
// `waiting`, so duplicate webhook deliveries lose the race and we never
// double-complete the trigger.dev wait token.
export async function resumeFlowWait(
  input: ResumeFlowWaitInput,
  deps: {
    completeWaitToken?: (
      tokenId: string,
      payload: Record<string, unknown>
    ) => Promise<void>;
  } = {}
): Promise<ResumeFlowWaitOutcome> {
  const completeWaitToken =
    deps.completeWaitToken ??
    (async (tokenId, payload) => {
      await wait.completeToken(tokenId, payload);
    });

  let update = supabaseAdmin
    .from("flow_waits")
    .update({
      status: "resumed",
      resumed_at: new Date().toISOString(),
      resume_payload: input.payload,
      resume_delivery_id: input.deliveryId,
    })
    .eq("id", input.candidate.id)
    .eq("status", "waiting");
  if (input.notExpiredAt) {
    update = update.gt("expires_at", input.notExpiredAt);
  }
  const { data, error } = await update.select("resume_token").maybeSingle();

  if (error) {
    throw new Error(`Failed to mark flow wait resumed: ${error.message}`);
  }
  if (!data) {
    return { resumed: false, reason: "already_resumed" };
  }

  try {
    await completeWaitToken(input.candidate.resume_token, input.payload);
    return { resumed: true, resumeToken: input.candidate.resume_token };
  } catch (completeError) {
    const message =
      completeError instanceof Error
        ? completeError.message
        : "Failed to complete wait token";
    // Token completion failed after we marked the row resumed. Try to roll the
    // row back so a follow-up delivery can retry. If the rollback ALSO fails,
    // the row is stranded — surface that explicitly so the caller can log
    // loudly and an operator can manually re-open the wait. Without this we'd
    // silently lose the next matching delivery (it would see `already_resumed`
    // and bail).
    const { error: rollbackError } = await supabaseAdmin
      .from("flow_waits")
      .update({
        status: "waiting",
        resumed_at: null,
        resume_payload: null,
        resume_delivery_id: null,
      })
      .eq("id", input.candidate.id);
    if (rollbackError) {
      console.error("[flow-wait] rollback failed after completeToken error", {
        waitId: input.candidate.id,
        resumeToken: input.candidate.resume_token,
        completeError: message,
        rollbackError: rollbackError.message,
      });
      return {
        resumed: false,
        reason: "complete_failed",
        message,
        rollbackFailed: true,
      };
    }
    return { resumed: false, reason: "complete_failed", message };
  }
}

// Find waits that *might* match an inbound webhook. The webhook handler refines
// matches further using event-specific config (label name, PR-only, etc.).
//
// Scope is *strict*: we never relax a missing predicate into a wildcard, since
// that would let a webhook in one tenant resume waits in another. Callers must
// pass an `installationId`, and `repoId` either pins to that repo or pins to
// repo-agnostic waits — it never matches arbitrary repos.
export async function findActiveFlowWaitsForEvent(input: {
  installationId: number | null;
  waitKind: FlowAwaitEventKind;
  repoId?: string | null;
}) {
  // Hard requirement: a webhook without an installation cannot identify a
  // tenant. Refuse to query rather than silently broadening the search across
  // all installations. (GitHub webhooks always carry an installation in
  // practice; treating its absence as "match nothing" keeps this safe even if
  // a malformed delivery somehow reaches us.)
  if (input.installationId === null) {
    return [];
  }

  let query = supabaseAdmin
    .from("flow_waits")
    .select(
      "id, user_id, job_run_id, flow_id, installation_id, repo_id, node_id, wait_kind, wait_config, resume_token"
    )
    .eq("wait_kind", input.waitKind)
    .eq("status", "waiting")
    .eq("installation_id", input.installationId);

  // With a repo scope: match either repo-scoped waits for this repo or
  // repo-agnostic waits. Without one: only match repo-agnostic waits — we
  // must not broaden to every wait in the installation just because the
  // caller couldn't resolve a repo row.
  query = input.repoId
    ? query.or(`repo_id.eq.${input.repoId},repo_id.is.null`)
    : query.is("repo_id", null);

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to load flow waits: ${error.message}`);
  }

  // Cast wait_config to its discriminated shape for caller convenience; the
  // row already validates `wait_kind` to one of the supported kinds.
  return (data ?? []).map((row) => ({
    id: row.id as string,
    user_id: row.user_id as string,
    job_run_id: row.job_run_id as string,
    flow_id: row.flow_id as string,
    installation_id: (row.installation_id as number | null) ?? null,
    repo_id: (row.repo_id as string | null) ?? null,
    node_id: row.node_id as string,
    wait_kind: row.wait_kind as FlowAwaitEventKind,
    wait_config: row.wait_config as FlowAwaitEventConfig,
    resume_token: row.resume_token as string,
  }));
}

// Bulk-load the published start.filter for a set of flow IDs. Used by the
// wait-routing dual-read in Phase 2: waits don't carry the filter directly, so
// we look it up via the parent flow's published version. Returns a Map keyed by
// flow_id; flows with no published version or no filter map to undefined.
export async function loadStartFiltersForFlowIds(
  flowIds: string[]
): Promise<Map<string, FlowStartFilter | undefined>> {
  const result = new Map<string, FlowStartFilter | undefined>();
  if (flowIds.length === 0) return result;

  const { data, error } = await supabaseAdmin
    .from("flows")
    .select(
      "id, published_version:flow_versions!flows_published_version_id_fkey(graph)"
    )
    .in("id", flowIds);

  if (error) {
    throw new Error(`Failed to load start filters: ${error.message}`);
  }

  for (const row of data ?? []) {
    const flowId = row.id as string;
    const published = Array.isArray(row.published_version)
      ? (row.published_version[0] ?? null)
      : (row.published_version as { graph: unknown } | null);
    if (!published) {
      result.set(flowId, undefined);
      continue;
    }
    const start = getStartConfig(coerceGraph(published.graph));
    result.set(flowId, start?.filter);
  }

  return result;
}
