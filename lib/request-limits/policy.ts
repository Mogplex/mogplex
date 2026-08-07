// Pure policy evaluation functions for request rate limiting.
// These functions are stateless and deterministic - they take inputs and
// return limit decisions without side effects.

import {
  CONCURRENCY_RETRY_AFTER_SECONDS,
  REQUEST_LIMITS,
  type AllowedLimitDecision,
  type DeniedLimitDecision,
  type LimitDecision,
  type LimitWindow,
} from "./types";

export function allowed(): AllowedLimitDecision {
  return { allowed: true };
}

export function denied(input: {
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
