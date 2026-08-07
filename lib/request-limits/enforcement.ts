// Enforcement functions for request rate limiting.
// These functions orchestrate policy evaluation, claim acquisition, and
// event recording for each limit type.

import { supabaseAdmin } from "@/lib/supabase/admin";
import { ACTIVE_CHAT_STALE_THRESHOLD_MS } from "@/lib/interactive-runs";
import {
  evaluateSandboxExecLimitPolicy,
  evaluateSnapshotBuildLimitPolicy,
} from "./policy";
import {
  loadAllowedLimitEventTimestamps,
  recordLimitDecision,
} from "./recording";
import { claimAtomicLimitDecision, type LimitRpc } from "./claims";
import { CONCURRENCY_RETRY_AFTER_SECONDS, REQUEST_LIMITS } from "./types";

export async function enforceChatLimits(input: {
  userId: string;
  repoId?: string | null;
  sandboxId?: string | null;
  now?: Date;
  rpc?: LimitRpc;
}) {
  const now = input.now ?? new Date();
  // Keep the SQL liveness threshold in sync with the UI/presenter threshold
  // in lib/interactive-runs.ts. A chat run older than this is a zombie from
  // an interrupted stream and must not block new chats.
  return claimAtomicLimitDecision(
    "claim_chat_limit_admission",
    {
      p_user_id: input.userId,
      p_repo_id: input.repoId ?? null,
      p_sandbox_id: input.sandboxId ?? null,
      p_now: now.toISOString(),
      p_stale_threshold_seconds: Math.floor(
        ACTIVE_CHAT_STALE_THRESHOLD_MS / 1000
      ),
    },
    input.rpc
  );
}

export async function enforceSandboxBootLimits(input: {
  userId: string;
  repoId: string;
  now?: Date;
  rpc?: LimitRpc;
}) {
  const now = input.now ?? new Date();
  const limits = REQUEST_LIMITS.sandboxBoot;
  return claimAtomicLimitDecision(
    "claim_sandbox_boot_limit_admission",
    {
      p_user_id: input.userId,
      p_repo_id: input.repoId,
      p_now: now.toISOString(),
      p_active_limit: limits.active.value,
      p_hourly_limit: limits.hourlyStarts.value,
      p_daily_limit: limits.dailyStarts.value,
      p_hourly_window_seconds: limits.hourlyStarts.windowSeconds,
      p_daily_window_seconds: limits.dailyStarts.windowSeconds,
    },
    input.rpc
  );
}

export async function enforceExternalAgentRunLimits(input: {
  userId: string;
  apiKeyId: string;
  repoId?: string | null;
  now?: Date;
  rpc?: LimitRpc;
}) {
  const now = input.now ?? new Date();
  const limits = REQUEST_LIMITS.externalAgentRun;
  return claimAtomicLimitDecision(
    "claim_external_agent_run_limit_admission",
    {
      p_user_id: input.userId,
      p_api_key_id: input.apiKeyId,
      p_repo_id: input.repoId ?? null,
      p_now: now.toISOString(),
      p_minutely_limit: limits.minutelyStarts.value,
      p_hourly_limit: limits.hourlyStarts.value,
      p_daily_limit: limits.dailyStarts.value,
      p_minutely_window_seconds: limits.minutelyStarts.windowSeconds,
      p_hourly_window_seconds: limits.hourlyStarts.windowSeconds,
      p_daily_window_seconds: limits.dailyStarts.windowSeconds,
    },
    input.rpc
  );
}

export async function enforceSnapshotBuildLimits(input: {
  userId: string;
  repoId: string;
  hasSnapshot: boolean;
  lastSnapshotCreatedAt: string | null;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const hourStart = new Date(
    now.getTime() -
      REQUEST_LIMITS.snapshotBuild.hourlyStarts.windowSeconds * 1000
  ).toISOString();
  const dayStart = new Date(
    now.getTime() -
      REQUEST_LIMITS.snapshotBuild.dailyStarts.windowSeconds * 1000
  ).toISOString();

  const [hourlyBuilds, dailyBuilds] = await Promise.all([
    loadAllowedLimitEventTimestamps({
      userId: input.userId,
      routeKey: "snapshot_build",
      since: hourStart,
    }),
    loadAllowedLimitEventTimestamps({
      userId: input.userId,
      routeKey: "snapshot_build",
      since: dayStart,
    }),
  ]);

  const decision = evaluateSnapshotBuildLimitPolicy({
    hourlyBuilds,
    dailyBuilds,
    hasSnapshot: input.hasSnapshot,
    lastSnapshotCreatedAt: input.lastSnapshotCreatedAt,
    now,
  });

  await recordLimitDecision({
    userId: input.userId,
    routeKey: "snapshot_build",
    decision,
    repoId: input.repoId,
    resourceId: input.repoId,
    metadata: {
      hourly_builds: hourlyBuilds.length,
      daily_builds: dailyBuilds.length,
      has_snapshot: input.hasSnapshot,
      snapshot_created_at: input.lastSnapshotCreatedAt,
    },
  });

  return decision;
}

export async function enforceSandboxExecLimits(input: {
  userId: string;
  sandboxId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const minuteStart = new Date(
    now.getTime() -
      REQUEST_LIMITS.sandboxExec.minutelyCalls.windowSeconds * 1000
  ).toISOString();
  const hourStart = new Date(
    now.getTime() - REQUEST_LIMITS.sandboxExec.hourlyCalls.windowSeconds * 1000
  ).toISOString();

  const [minuteExecs, hourlyExecs] = await Promise.all([
    loadAllowedLimitEventTimestamps({
      userId: input.userId,
      routeKey: "sandbox_exec",
      since: minuteStart,
    }),
    loadAllowedLimitEventTimestamps({
      userId: input.userId,
      routeKey: "sandbox_exec",
      since: hourStart,
    }),
  ]);

  const decision = evaluateSandboxExecLimitPolicy({
    minuteExecs,
    hourlyExecs,
    now,
  });

  await recordLimitDecision({
    userId: input.userId,
    routeKey: "sandbox_exec",
    decision,
    sandboxId: input.sandboxId,
    resourceId: input.sandboxId,
    metadata: {
      minute_execs: minuteExecs.length,
      hourly_execs: hourlyExecs.length,
    },
  });

  return decision;
}

export async function acquireSandboxExecLock(
  sandboxId: string,
  now = new Date()
) {
  const { data: current, error } = await supabaseAdmin
    .from("sandboxes")
    .select("id, exec_lock_token, exec_lock_started_at")
    .eq("id", sandboxId)
    .single();

  if (error || !current) {
    throw new Error(
      error?.message || `Failed to load sandbox ${sandboxId} exec lock state`
    );
  }

  const startedAt = current.exec_lock_started_at
    ? new Date(current.exec_lock_started_at).getTime()
    : null;
  const stale =
    startedAt == null ||
    now.getTime() - startedAt >=
      REQUEST_LIMITS.sandboxExec.lockStaleSeconds * 1000;

  if (current.exec_lock_token && !stale) {
    return {
      acquired: false as const,
      retryAfterSeconds: CONCURRENCY_RETRY_AFTER_SECONDS,
    };
  }

  const nextToken = crypto.randomUUID();
  let query = supabaseAdmin
    .from("sandboxes")
    .update({
      exec_lock_token: nextToken,
      exec_lock_started_at: now.toISOString(),
    })
    .eq("id", sandboxId);

  query = current.exec_lock_token
    ? query.eq("exec_lock_token", current.exec_lock_token)
    : query.is("exec_lock_token", null);

  const { data: updated, error: updateError } = await query
    .select("id")
    .maybeSingle();

  if (updateError) {
    throw new Error(
      `Failed to acquire sandbox exec lock for ${sandboxId}: ${updateError.message}`
    );
  }

  if (!updated) {
    return {
      acquired: false as const,
      retryAfterSeconds: CONCURRENCY_RETRY_AFTER_SECONDS,
    };
  }

  return {
    acquired: true as const,
    token: nextToken,
  };
}

export async function releaseSandboxExecLock(sandboxId: string, token: string) {
  const { error } = await supabaseAdmin
    .from("sandboxes")
    .update({
      exec_lock_token: null,
      exec_lock_started_at: null,
    })
    .eq("id", sandboxId)
    .eq("exec_lock_token", token);

  if (error) {
    throw new Error(
      `Failed to release sandbox exec lock for ${sandboxId}: ${error.message}`
    );
  }
}
