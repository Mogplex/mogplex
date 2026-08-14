// Types and constants for request rate limiting.

import { MAX_SANDBOX_TIMEOUT_MS } from "@/lib/repo-settings";

export const LIMIT_ROUTE_KEYS = [
  "chat",
  "external_agent_run",
  "sandbox_boot",
  "snapshot_build",
  "sandbox_exec",
] as const;

export type LimitRouteKey = (typeof LIMIT_ROUTE_KEYS)[number];

export type LimitWindow = {
  name: string;
  value: number;
  windowSeconds: number;
};

export type AllowedLimitDecision = {
  allowed: true;
  claimId?: string;
};

export type DeniedLimitDecision = {
  allowed: false;
  status: 429;
  code: string;
  error: string;
  reason: string;
  retryAfterSeconds: number;
  limit: LimitWindow;
};

export type LimitDecision = AllowedLimitDecision | DeniedLimitDecision;

export type LimitEventInsert = {
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

export const CONCURRENCY_RETRY_AFTER_SECONDS = 15;
