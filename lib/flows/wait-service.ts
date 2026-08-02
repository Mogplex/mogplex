import { wait } from "@trigger.dev/sdk/v3";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type {
  FlowAwaitEventConfig,
  FlowAwaitEventKind,
  FlowStartFilter,
  FlowWait,
} from "@/lib/types";
import { coerceGraph, getStartConfig } from "./graph";
import {
  evaluateTriggerFilter,
  type TriggerFilterAccountType,
} from "./trigger-filter";
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

// Webhook-facing entry point for GitHub `labeled` events. Routes the event to
// every active wait that matches the label and scope, runs each through the
// CAS resume, and returns a per-wait outcome list. Idempotency is enforced by
// the row-level CAS in resumeFlowWait, so duplicate deliveries lose the race
// and never call wait.completeToken twice.
export type GithubLabeledEvent = {
  installationId: number | null;
  repoId: string | null;
  repoFullName: string | null;
  accountType: TriggerFilterAccountType;
  labelName: string;
  isPullRequest: boolean;
  deliveryId: string | null;
  payload: Record<string, unknown>;
};

export type RouteFlowWaitsOutcome = {
  matched: number;
  resumed: number;
  alreadyResumed: number;
  completeFailed: number;
  failures: string[];
};

export type RouteGithubLabeledOutcome = RouteFlowWaitsOutcome;

async function emitWaitDualReadParityLog(
  event: GithubLabeledEvent,
  matches: Array<{ id: string; flow_id: string }>,
  loadStartFilters: typeof loadStartFiltersForFlowIds
) {
  if (matches.length === 0) return;
  if (event.installationId == null) {
    // Surface coverage gaps explicitly: silent no-ops would let the 48h grep
    // under-count without warning. Should never fire on the real path
    // (findActiveFlowWaitsForEvent already returns [] for null installations),
    // but if a future refactor changes that, ops will see it immediately.
    console.warn(
      JSON.stringify({
        event: "wait_routing_dual_read_skipped",
        delivery_id: event.deliveryId,
        repo_full_name: event.repoFullName,
        label_name: event.labelName,
        waits_id_matched: matches.length,
        reason: "missing_installation_id",
      })
    );
    return;
  }

  const flowIds = Array.from(new Set(matches.map((m) => m.flow_id)));
  let filtersByFlowId: Map<string, FlowStartFilter | undefined>;
  try {
    filtersByFlowId = await loadStartFilters(flowIds);
  } catch (error) {
    // Never let dual-read instrumentation interfere with resume routing.
    console.warn(
      JSON.stringify({
        event: "wait_routing_dual_read_lookup_failed",
        delivery_id: event.deliveryId,
        installation_id: event.installationId,
        error: error instanceof Error ? error.message : String(error),
      })
    );
    return;
  }

  // Label events carry no PR-author context, so authorFilter modes degrade
  // here: exclusion modes count as matched, dependabot_only as not matched.
  // Fine while this is shadow-only, but if Phase 3 makes the filter gate
  // resumes, dependabot_only flows would need author context plumbed through
  // (or authorFilter exempted from resume routing) to avoid blocking their
  // own waits.
  const ctx = {
    installationId: event.installationId,
    repoFullName: event.repoFullName,
    accountType: event.accountType,
  };

  let filterMatched = 0;
  let noFilter = 0;
  const diffWaitIds: string[] = [];

  for (const match of matches) {
    const filter = filtersByFlowId.get(match.flow_id);
    if (!filter) noFilter += 1;
    if (evaluateTriggerFilter(filter, ctx)) {
      filterMatched += 1;
    } else {
      diffWaitIds.push(match.id);
    }
  }

  console.log(
    JSON.stringify({
      event: "wait_routing_dual_read",
      delivery_id: event.deliveryId,
      installation_id: event.installationId,
      account_type: event.accountType,
      repo_full_name: event.repoFullName,
      label_name: event.labelName,
      waits_id_matched: matches.length,
      waits_filter_matched: filterMatched,
      waits_no_filter: noFilter,
      diff_wait_ids: diffWaitIds,
    })
  );
}

export async function routeGithubLabeledEventToFlowWaits(
  event: GithubLabeledEvent,
  deps: {
    findCandidates?: typeof findActiveFlowWaitsForEvent;
    resumeWait?: typeof resumeFlowWait;
    loadStartFilters?: typeof loadStartFiltersForFlowIds;
  } = {}
): Promise<RouteGithubLabeledOutcome> {
  const findCandidates = deps.findCandidates ?? findActiveFlowWaitsForEvent;
  const resumeWait = deps.resumeWait ?? resumeFlowWait;
  const loadStartFilters = deps.loadStartFilters ?? loadStartFiltersForFlowIds;

  const candidates = await findCandidates({
    installationId: event.installationId,
    waitKind: "github_label_added",
    repoId: event.repoId,
  });

  const matches = candidates.filter((candidate) => {
    if (candidate.wait_config.kind !== "github_label_added") return false;
    if (candidate.wait_config.labelName !== event.labelName) return false;
    if (candidate.wait_config.prOnly && !event.isPullRequest) return false;
    return true;
  });

  // Phase 2 shadow read: evaluate the parent flow's start.filter against this
  // delivery so we can confirm parity in prod for >=48h before Phase 3 flips
  // routing to the filter as primary. Does NOT gate resumes — every match
  // continues to the CAS as before.
  await emitWaitDualReadParityLog(event, matches, loadStartFilters);

  let resumed = 0;
  let alreadyResumed = 0;
  let completeFailed = 0;
  const failures: string[] = [];

  for (const candidate of matches) {
    try {
      const outcome = await resumeWait({
        candidate,
        payload: event.payload,
        deliveryId: event.deliveryId,
      });
      if (outcome.resumed) {
        resumed += 1;
      } else if (outcome.reason === "already_resumed") {
        alreadyResumed += 1;
      } else {
        completeFailed += 1;
        if (outcome.message) failures.push(outcome.message);
      }
    } catch (error) {
      completeFailed += 1;
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }

  return {
    matched: matches.length,
    resumed,
    alreadyResumed,
    completeFailed,
    failures,
  };
}

export type GithubCommentAddedEvent = {
  installationId: number | null;
  repoId: string | null;
  issueNumber: number;
  isPullRequest: boolean;
  authorLogin: string;
  body: string;
  deliveryId: string | null;
  payload: Record<string, unknown>;
};

export async function routeGithubCommentAddedEventToFlowWaits(
  event: GithubCommentAddedEvent,
  deps: {
    findCandidates?: typeof findActiveFlowWaitsForEvent;
    resumeWait?: typeof resumeFlowWait;
  } = {}
): Promise<RouteFlowWaitsOutcome> {
  const findCandidates = deps.findCandidates ?? findActiveFlowWaitsForEvent;
  const resumeWait = deps.resumeWait ?? resumeFlowWait;
  const candidates = await findCandidates({
    installationId: event.installationId,
    waitKind: "github_comment_added",
    repoId: event.repoId,
  });
  const normalizedBody = event.body.toLowerCase();
  const matches = candidates.filter((candidate) => {
    const config = candidate.wait_config;
    if (config.kind !== "github_comment_added") return false;
    if (
      config.expectedIssueNumber != null &&
      config.expectedIssueNumber !== event.issueNumber
    ) {
      return false;
    }
    if (config.prOnly && !event.isPullRequest) return false;
    if (
      config.authorLogin.trim() &&
      !sameName(config.authorLogin, event.authorLogin)
    ) {
      return false;
    }
    const bodyContains = config.bodyContains.trim().toLowerCase();
    return !bodyContains || normalizedBody.includes(bodyContains);
  });

  return resumeMatchingFlowWaits({
    matches,
    payload: event.payload,
    deliveryId: event.deliveryId,
    resumeWait,
  });
}

async function resumeMatchingFlowWaits(input: {
  matches: ResumeFlowWaitCandidate[];
  payload: Record<string, unknown>;
  deliveryId: string | null;
  resumeWait: typeof resumeFlowWait;
}): Promise<RouteFlowWaitsOutcome> {
  let resumed = 0;
  let alreadyResumed = 0;
  let completeFailed = 0;
  const failures: string[] = [];

  for (const candidate of input.matches) {
    try {
      const outcome = await input.resumeWait({
        candidate,
        payload: input.payload,
        deliveryId: input.deliveryId,
      });
      if (outcome.resumed) {
        resumed += 1;
      } else if (outcome.reason === "already_resumed") {
        alreadyResumed += 1;
      } else {
        completeFailed += 1;
        if (outcome.message) failures.push(outcome.message);
      }
    } catch (error) {
      completeFailed += 1;
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }

  return {
    matched: input.matches.length,
    resumed,
    alreadyResumed,
    completeFailed,
    failures,
  };
}

function sameOptionalSha(expectedSha: string | null | undefined, sha: string) {
  const expected = expectedSha?.trim();
  return !expected || expected.toLowerCase() === sha.trim().toLowerCase();
}

function sameName(left: string, right: string) {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

export type GithubCiCompletedEvent = {
  installationId: number | null;
  repoId: string | null;
  workflowName: string;
  conclusion: string | null;
  headSha: string;
  deliveryId: string | null;
  payload: Record<string, unknown>;
};

export async function routeGithubCiCompletedEventToFlowWaits(
  event: GithubCiCompletedEvent,
  deps: {
    findCandidates?: typeof findActiveFlowWaitsForEvent;
    resumeWait?: typeof resumeFlowWait;
  } = {}
): Promise<RouteFlowWaitsOutcome> {
  const findCandidates = deps.findCandidates ?? findActiveFlowWaitsForEvent;
  const resumeWait = deps.resumeWait ?? resumeFlowWait;
  const candidates = await findCandidates({
    installationId: event.installationId,
    waitKind: "ci_workflow_completed",
    repoId: event.repoId,
  });
  const matches = candidates.filter((candidate) => {
    const config = candidate.wait_config;
    if (config.kind !== "ci_workflow_completed") return false;
    if (!sameName(config.workflowName, event.workflowName)) return false;
    if (config.conclusion !== "any" && config.conclusion !== event.conclusion) {
      return false;
    }
    return sameOptionalSha(config.expectedSha, event.headSha);
  });

  return resumeMatchingFlowWaits({
    matches,
    payload: event.payload,
    deliveryId: event.deliveryId,
    resumeWait,
  });
}

export type GithubVercelPreviewReadyEvent = {
  installationId: number | null;
  repoId: string | null;
  environment: string;
  sha: string;
  deliveryId: string | null;
  payload: Record<string, unknown>;
};

export async function routeGithubVercelPreviewReadyEventToFlowWaits(
  event: GithubVercelPreviewReadyEvent,
  deps: {
    findCandidates?: typeof findActiveFlowWaitsForEvent;
    resumeWait?: typeof resumeFlowWait;
  } = {}
): Promise<RouteFlowWaitsOutcome> {
  const findCandidates = deps.findCandidates ?? findActiveFlowWaitsForEvent;
  const resumeWait = deps.resumeWait ?? resumeFlowWait;
  const candidates = await findCandidates({
    installationId: event.installationId,
    waitKind: "vercel_preview_ready",
    repoId: event.repoId,
  });
  const matches = candidates.filter((candidate) => {
    const config = candidate.wait_config;
    if (config.kind !== "vercel_preview_ready") return false;
    if (!sameName(config.environment, event.environment)) return false;
    return sameOptionalSha(config.expectedSha, event.sha);
  });

  return resumeMatchingFlowWaits({
    matches,
    payload: event.payload,
    deliveryId: event.deliveryId,
    resumeWait,
  });
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
