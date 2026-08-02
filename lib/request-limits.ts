import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ACTIVE_CHAT_STALE_THRESHOLD_MS } from "@/lib/interactive-runs";
import { MAX_SANDBOX_TIMEOUT_MS } from "@/lib/repo-settings";

export const LIMIT_ROUTE_KEYS = [
  "chat",
  "external_agent_run",
  "sandbox_boot",
  "snapshot_build",
  "sandbox_exec",
] as const;

export type LimitRouteKey = (typeof LIMIT_ROUTE_KEYS)[number];

type LimitWindow = {
  name: string;
  value: number;
  windowSeconds: number;
};

type AllowedLimitDecision = {
  allowed: true;
  claimId?: string;
};

type DeniedLimitDecision = {
  allowed: false;
  status: 429;
  code: string;
  error: string;
  reason: string;
  retryAfterSeconds: number;
  limit: LimitWindow;
};

export type LimitDecision = AllowedLimitDecision | DeniedLimitDecision;

type LimitEventInsert = {
  userId: string;
  routeKey: LimitRouteKey;
  decision: "allowed" | "denied";
  claimId?: string | null;
  resourceId?: string | null;
  repoId?: string | null;
  sandboxId?: string | null;
  reason?: string | null;
  limitName?: string | null;
  windowSeconds?: number | null;
  limitValue?: number | null;
  remaining?: number | null;
  retryAfterSeconds?: number | null;
  metadata?: Record<string, unknown>;
};

export const REQUEST_LIMITS = {
  chat: {
    concurrent: { name: "concurrent_chat_runs", value: 2, windowSeconds: 0 },
    hourlyStarts: {
      name: "chat_starts_per_hour",
      value: 30,
      windowSeconds: 60 * 60,
    },
    dailyStarts: {
      name: "chat_starts_per_day",
      value: 150,
      windowSeconds: 24 * 60 * 60,
    },
  },
  externalAgentRun: {
    minutelyStarts: {
      name: "external_agent_runs_per_minute",
      value: 10,
      windowSeconds: 60,
    },
    hourlyStarts: {
      name: "external_agent_runs_per_hour",
      value: 30,
      windowSeconds: 60 * 60,
    },
    dailyStarts: {
      name: "external_agent_runs_per_day",
      value: 150,
      windowSeconds: 24 * 60 * 60,
    },
  },
  sandboxBoot: {
    active: { name: "active_sandboxes", value: 3, windowSeconds: 0 },
    hourlyStarts: {
      name: "sandbox_boots_per_hour",
      value: 120,
      windowSeconds: 60 * 60,
    },
    dailyStarts: {
      name: "sandbox_boots_per_day",
      value: 10000,
      windowSeconds: 24 * 60 * 60,
    },
  },
  snapshotBuild: {
    hourlyStarts: {
      name: "snapshot_builds_per_hour",
      value: 3,
      windowSeconds: 60 * 60,
    },
    dailyStarts: {
      name: "snapshot_builds_per_day",
      value: 10,
      windowSeconds: 24 * 60 * 60,
    },
    cooldownSeconds: 15 * 60,
  },
  sandboxExec: {
    minutelyCalls: {
      name: "sandbox_execs_per_minute",
      value: 20,
      windowSeconds: 60,
    },
    hourlyCalls: {
      name: "sandbox_execs_per_hour",
      value: 120,
      windowSeconds: 60 * 60,
    },
    concurrent: { name: "sandbox_exec_in_flight", value: 1, windowSeconds: 0 },
    lockStaleSeconds: Math.floor(MAX_SANDBOX_TIMEOUT_MS / 1000),
  },
} as const;

const CONCURRENCY_RETRY_AFTER_SECONDS = 15;

function allowed(): AllowedLimitDecision {
  return { allowed: true };
}

function denied(input: {
  code: string;
  error: string;
  reason: string;
  retryAfterSeconds: number;
  limit: LimitWindow;
}): DeniedLimitDecision {
  return {
    allowed: false,
    status: 429,
    code: input.code,
    error: input.error,
    reason: input.reason,
    retryAfterSeconds: Math.max(1, input.retryAfterSeconds),
    limit: input.limit,
  };
}

function uniqueSortedTimestamps(values: readonly string[]) {
  return values
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
}

function computeRetryAfterSeconds(
  timestamps: readonly string[],
  windowSeconds: number,
  now: Date
) {
  if (timestamps.length === 0 || windowSeconds <= 0)
    return CONCURRENCY_RETRY_AFTER_SECONDS;

  const sorted = uniqueSortedTimestamps(timestamps);
  const oldest = sorted[0];
  if (!Number.isFinite(oldest)) return CONCURRENCY_RETRY_AFTER_SECONDS;

  const retryAfterMs = oldest + windowSeconds * 1000 - now.getTime();
  return Math.max(1, Math.ceil(retryAfterMs / 1000));
}

function evaluateWindowLimit(input: {
  timestamps: readonly string[];
  now: Date;
  limit: LimitWindow;
  code: string;
  error: string;
  reason: string;
}) {
  if (input.timestamps.length < input.limit.value) return allowed();

  return denied({
    code: input.code,
    error: input.error,
    reason: input.reason,
    retryAfterSeconds: computeRetryAfterSeconds(
      input.timestamps,
      input.limit.windowSeconds,
      input.now
    ),
    limit: input.limit,
  });
}

export function evaluateChatLimitPolicy(input: {
  activeChats: number;
  hourlyStarts: readonly string[];
  dailyStarts: readonly string[];
  now?: Date;
}): LimitDecision {
  const now = input.now ?? new Date();

  if (input.activeChats >= REQUEST_LIMITS.chat.concurrent.value) {
    return denied({
      code: "chat_rate_limited",
      error: "Too many active chat runs",
      reason: "concurrent_chat_runs_exceeded",
      retryAfterSeconds: CONCURRENCY_RETRY_AFTER_SECONDS,
      limit: REQUEST_LIMITS.chat.concurrent,
    });
  }

  const hourlyDecision = evaluateWindowLimit({
    timestamps: input.hourlyStarts,
    now,
    limit: REQUEST_LIMITS.chat.hourlyStarts,
    code: "chat_rate_limited",
    error: "Chat rate limit exceeded",
    reason: "chat_hourly_rate_exceeded",
  });
  if (!hourlyDecision.allowed) return hourlyDecision;

  return evaluateWindowLimit({
    timestamps: input.dailyStarts,
    now,
    limit: REQUEST_LIMITS.chat.dailyStarts,
    code: "chat_rate_limited",
    error: "Daily chat quota exceeded",
    reason: "chat_daily_quota_exceeded",
  });
}

export function evaluateSandboxBootLimitPolicy(input: {
  activeSandboxes: number;
  hourlyBoots: readonly string[];
  dailyBoots: readonly string[];
  now?: Date;
}): LimitDecision {
  const now = input.now ?? new Date();

  if (input.activeSandboxes >= REQUEST_LIMITS.sandboxBoot.active.value) {
    return denied({
      code: "sandbox_boot_rate_limited",
      error: "Too many active sandboxes",
      reason: "active_sandbox_limit_exceeded",
      retryAfterSeconds: CONCURRENCY_RETRY_AFTER_SECONDS,
      limit: REQUEST_LIMITS.sandboxBoot.active,
    });
  }

  const hourlyDecision = evaluateWindowLimit({
    timestamps: input.hourlyBoots,
    now,
    limit: REQUEST_LIMITS.sandboxBoot.hourlyStarts,
    code: "sandbox_boot_rate_limited",
    error: "Sandbox boot rate limit exceeded",
    reason: "sandbox_boot_hourly_rate_exceeded",
  });
  if (!hourlyDecision.allowed) return hourlyDecision;

  return evaluateWindowLimit({
    timestamps: input.dailyBoots,
    now,
    limit: REQUEST_LIMITS.sandboxBoot.dailyStarts,
    code: "sandbox_boot_rate_limited",
    error: "Daily sandbox boot quota exceeded",
    reason: "sandbox_boot_daily_quota_exceeded",
  });
}

export function evaluateExternalAgentRunLimitPolicy(input: {
  minutelyStarts: readonly string[];
  hourlyStarts: readonly string[];
  dailyStarts: readonly string[];
  now?: Date;
}): LimitDecision {
  const now = input.now ?? new Date();

  const minutelyDecision = evaluateWindowLimit({
    timestamps: input.minutelyStarts,
    now,
    limit: REQUEST_LIMITS.externalAgentRun.minutelyStarts,
    code: "external_agent_run_rate_limited",
    error: "External Mogplex run rate limit exceeded",
    reason: "external_agent_run_minutely_rate_exceeded",
  });
  if (!minutelyDecision.allowed) return minutelyDecision;

  const hourlyDecision = evaluateWindowLimit({
    timestamps: input.hourlyStarts,
    now,
    limit: REQUEST_LIMITS.externalAgentRun.hourlyStarts,
    code: "external_agent_run_rate_limited",
    error: "External Mogplex run rate limit exceeded",
    reason: "external_agent_run_hourly_rate_exceeded",
  });
  if (!hourlyDecision.allowed) return hourlyDecision;

  return evaluateWindowLimit({
    timestamps: input.dailyStarts,
    now,
    limit: REQUEST_LIMITS.externalAgentRun.dailyStarts,
    code: "external_agent_run_rate_limited",
    error: "Daily external Mogplex run quota exceeded",
    reason: "external_agent_run_daily_quota_exceeded",
  });
}

export function evaluateSnapshotBuildLimitPolicy(input: {
  hourlyBuilds: readonly string[];
  dailyBuilds: readonly string[];
  hasSnapshot: boolean;
  lastSnapshotCreatedAt: string | null;
  now?: Date;
}): LimitDecision {
  const now = input.now ?? new Date();

  const hourlyDecision = evaluateWindowLimit({
    timestamps: input.hourlyBuilds,
    now,
    limit: REQUEST_LIMITS.snapshotBuild.hourlyStarts,
    code: "snapshot_rate_limited",
    error: "Snapshot build rate limit exceeded",
    reason: "snapshot_build_hourly_rate_exceeded",
  });
  if (!hourlyDecision.allowed) return hourlyDecision;

  const dailyDecision = evaluateWindowLimit({
    timestamps: input.dailyBuilds,
    now,
    limit: REQUEST_LIMITS.snapshotBuild.dailyStarts,
    code: "snapshot_rate_limited",
    error: "Daily snapshot build quota exceeded",
    reason: "snapshot_build_daily_quota_exceeded",
  });
  if (!dailyDecision.allowed) return dailyDecision;

  if (input.hasSnapshot && input.lastSnapshotCreatedAt) {
    const ageSeconds = Math.floor(
      (now.getTime() - new Date(input.lastSnapshotCreatedAt).getTime()) / 1000
    );
    if (
      Number.isFinite(ageSeconds) &&
      ageSeconds < REQUEST_LIMITS.snapshotBuild.cooldownSeconds
    ) {
      return denied({
        code: "snapshot_rate_limited",
        error: "Snapshot build is cooling down",
        reason: "snapshot_build_cooldown_active",
        retryAfterSeconds:
          REQUEST_LIMITS.snapshotBuild.cooldownSeconds - ageSeconds,
        limit: {
          name: "snapshot_build_cooldown",
          value: 1,
          windowSeconds: REQUEST_LIMITS.snapshotBuild.cooldownSeconds,
        },
      });
    }
  }

  return allowed();
}

export function evaluateSandboxExecLimitPolicy(input: {
  minuteExecs: readonly string[];
  hourlyExecs: readonly string[];
  now?: Date;
}): LimitDecision {
  const now = input.now ?? new Date();

  const minutelyDecision = evaluateWindowLimit({
    timestamps: input.minuteExecs,
    now,
    limit: REQUEST_LIMITS.sandboxExec.minutelyCalls,
    code: "sandbox_exec_rate_limited",
    error: "Sandbox exec rate limit exceeded",
    reason: "sandbox_exec_minutely_rate_exceeded",
  });
  if (!minutelyDecision.allowed) return minutelyDecision;

  return evaluateWindowLimit({
    timestamps: input.hourlyExecs,
    now,
    limit: REQUEST_LIMITS.sandboxExec.hourlyCalls,
    code: "sandbox_exec_rate_limited",
    error: "Hourly sandbox exec quota exceeded",
    reason: "sandbox_exec_hourly_rate_exceeded",
  });
}

export function buildSandboxExecConcurrencyDecision(): DeniedLimitDecision {
  return denied({
    code: "sandbox_exec_concurrency_limited",
    error: "Another sandbox command is already running",
    reason: "sandbox_exec_in_flight",
    retryAfterSeconds: CONCURRENCY_RETRY_AFTER_SECONDS,
    limit: REQUEST_LIMITS.sandboxExec.concurrent,
  });
}

export function buildLimitResponse(decision: DeniedLimitDecision) {
  return NextResponse.json(
    {
      error: decision.error,
      code: decision.code,
      retryAfterSeconds: decision.retryAfterSeconds,
      limit: decision.limit,
    },
    {
      status: decision.status,
      headers: {
        "Retry-After": String(decision.retryAfterSeconds),
      },
    }
  );
}

async function safeInsertLimitEvent(input: LimitEventInsert) {
  try {
    const { error } = await supabaseAdmin.from("limit_events").insert({
      user_id: input.userId,
      route_key: input.routeKey,
      decision: input.decision,
      claim_id: input.claimId ?? null,
      resource_id: input.resourceId ?? null,
      repo_id: input.repoId ?? null,
      sandbox_id: input.sandboxId ?? null,
      reason: input.reason ?? null,
      limit_name: input.limitName ?? null,
      window_seconds: input.windowSeconds ?? null,
      limit_value: input.limitValue ?? null,
      remaining: input.remaining ?? null,
      retry_after_seconds: input.retryAfterSeconds ?? null,
      metadata: input.metadata ?? {},
    });

    if (error) {
      console.error("[limits] failed to insert limit_event", { input, error });
    }
  } catch (error) {
    console.error("[limits] failed to insert limit_event", { input, error });
  }
}

export async function recordLimitDecision(input: {
  userId: string;
  routeKey: LimitRouteKey;
  decision: LimitDecision;
  resourceId?: string | null;
  repoId?: string | null;
  sandboxId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  if (input.decision.allowed) {
    await safeInsertLimitEvent({
      userId: input.userId,
      routeKey: input.routeKey,
      decision: "allowed",
      claimId: input.decision.claimId ?? null,
      resourceId: input.resourceId,
      repoId: input.repoId,
      sandboxId: input.sandboxId,
      metadata: input.metadata,
    });
    return;
  }

  await safeInsertLimitEvent({
    userId: input.userId,
    routeKey: input.routeKey,
    decision: "denied",
    resourceId: input.resourceId,
    repoId: input.repoId,
    sandboxId: input.sandboxId,
    reason: input.decision.reason,
    limitName: input.decision.limit.name,
    windowSeconds: input.decision.limit.windowSeconds,
    limitValue: input.decision.limit.value,
    remaining: 0,
    retryAfterSeconds: input.decision.retryAfterSeconds,
    metadata: input.metadata,
  });
}

async function loadAllowedLimitEventTimestamps(input: {
  userId: string;
  routeKey: LimitRouteKey;
  since: string;
  resourceId?: string | null;
}) {
  let query = supabaseAdmin
    .from("limit_events")
    .select("created_at")
    .eq("user_id", input.userId)
    .eq("route_key", input.routeKey)
    .eq("decision", "allowed")
    .gte("created_at", input.since)
    .order("created_at", { ascending: true });

  if (input.resourceId !== undefined) {
    query =
      input.resourceId === null
        ? query.is("resource_id", null)
        : query.eq("resource_id", input.resourceId);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(
      `Failed to load limit_events for ${input.routeKey}: ${error.message}`
    );
  }

  return (data ?? [])
    .map((entry) => entry.created_at)
    .filter((value): value is string => typeof value === "string");
}

// Only provisional/admission claims with a refund path belong here.
// External agent runs are atomically admitted too, but their start quota is
// intentionally non-refundable once a run request has been accepted.
type AtomicLimitClaimRouteKey = "chat" | "sandbox_boot";
type LimitRpcResponse = {
  data: unknown;
  error: { message: string } | null;
};

type LimitRpc = (
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

async function claimAtomicLimitDecision(
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
