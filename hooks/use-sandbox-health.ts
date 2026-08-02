"use client";
import { useEffect, useCallback, useMemo, useRef } from "react";
import { useSandboxStore } from "@/hooks/use-sandbox";
import type { SandboxHealthStatus } from "@/lib/sandbox/health-status";
import type { SandboxRecord } from "@/lib/types";

type SandboxHealthRecord = Pick<SandboxRecord, "runtime_summary">;

const DEGRADED_STATUSES: ReadonlySet<string> = new Set([
  "app_error",
  "unreachable",
  "starting",
  "not_available",
]);
const STARTING_RUNTIME_STATUSES: ReadonlySet<string> = new Set([
  "creating",
  "installing",
]);
const ERROR_RUNTIME_HEALTH_STATUSES: ReadonlySet<SandboxHealthStatus> = new Set(
  ["app_error", "unreachable", "not_available"]
);

const INITIAL_RETRY_DELAY_MS = 5_000;
const MAX_RETRY_DELAY_MS = 30_000;
const BACKOFF_FACTOR = 1.5;

function getRuntimeDerivedHealthStatus(
  runtimeStatus: string,
  healthStatus: SandboxHealthStatus | undefined
): SandboxHealthStatus | null {
  if (STARTING_RUNTIME_STATUSES.has(runtimeStatus)) return "starting";
  if (runtimeStatus === "pausing") return "pausing";
  if (runtimeStatus === "stopped") return "stopped";
  if (runtimeStatus !== "error") return null;

  return healthStatus && ERROR_RUNTIME_HEALTH_STATUSES.has(healthStatus)
    ? healthStatus
    : "error";
}

function getFallbackHealthStatus(
  runtimeStatus: string,
  healthStatus: SandboxHealthStatus | undefined
): SandboxHealthStatus {
  if (healthStatus === "idle_warning") return "idle_warning";
  if (healthStatus) return healthStatus;
  return runtimeStatus === "running" ? "running" : "not_available";
}

export function deriveSandboxHealthStatus(
  record: SandboxHealthRecord | null | undefined
): SandboxHealthStatus {
  const runtimeSummary = record?.runtime_summary;
  if (!runtimeSummary) return "not_available";

  const runtimeStatus = runtimeSummary.status;
  const healthStatus = runtimeSummary.health_status as
    | SandboxHealthStatus
    | undefined;

  return (
    getRuntimeDerivedHealthStatus(runtimeStatus, healthStatus) ??
    getFallbackHealthStatus(runtimeStatus, healthStatus)
  );
}

type UseSandboxHealthOpts = {
  sandboxRecordId?: string;
  enabled?: boolean;
};

/**
 * Reconciles sandbox health on demand and schedules recovery retries when the
 * preview is in a degraded state (app_error, unreachable, starting). Uses a
 * single-flight setTimeout with exponential backoff — not a polling loop.
 * Retries stop when status reaches running, stopped, or error.
 */
export function useSandboxHealth({
  sandboxRecordId,
  enabled = true,
}: UseSandboxHealthOpts) {
  const setSandboxRecord = useSandboxStore((s) => s.setSandboxRecord);
  const sandboxRecord = useSandboxStore((s) =>
    sandboxRecordId ? s.getSandboxById(sandboxRecordId) : null
  );

  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryDelayRef = useRef(INITIAL_RETRY_DELAY_MS);
  const disposedRef = useRef(false);

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const reconcileHealth = useCallback(async () => {
    if (!sandboxRecordId) return;

    try {
      const res = await fetch(`/api/sandbox/${sandboxRecordId}/health`, {
        cache: "no-store",
      });
      if (!res.ok) return;

      const data = await res.json();
      if (data.sandbox) {
        setSandboxRecord(data.sandbox as SandboxRecord);
      }
    } catch {
      // Leave the current store state intact on transient network failure.
    }
  }, [sandboxRecordId, setSandboxRecord]);

  const effectiveStatus = useMemo(
    () =>
      sandboxRecordId
        ? deriveSandboxHealthStatus(sandboxRecord)
        : ("not_available" as const),
    [sandboxRecordId, sandboxRecord]
  );

  useEffect(() => {
    if (!enabled || !sandboxRecordId) return;
    if (effectiveStatus === "stopped" || effectiveStatus === "error") {
      clearRetryTimer();
      return;
    }

    void reconcileHealth();

    const handleFocus = () => {
      void reconcileHealth();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void reconcileHealth();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [
    enabled,
    sandboxRecordId,
    effectiveStatus,
    reconcileHealth,
    clearRetryTimer,
  ]);

  useEffect(() => {
    if (!enabled || !sandboxRecordId) return;

    const isDegraded = DEGRADED_STATUSES.has(effectiveStatus);
    if (!isDegraded) {
      clearRetryTimer();
      retryDelayRef.current = INITIAL_RETRY_DELAY_MS;
      return;
    }

    function scheduleRetry() {
      clearRetryTimer();
      retryTimerRef.current = setTimeout(() => {
        if (disposedRef.current) return;
        retryTimerRef.current = null;
        void reconcileHealth().then(() => {
          if (disposedRef.current) return;
          retryDelayRef.current = Math.min(
            retryDelayRef.current * BACKOFF_FACTOR,
            MAX_RETRY_DELAY_MS
          );
          const stillDegraded = DEGRADED_STATUSES.has(
            deriveSandboxHealthStatus(
              useSandboxStore.getState().sandboxesById[sandboxRecordId!] ?? null
            )
          );
          if (stillDegraded) {
            scheduleRetry();
          } else {
            retryDelayRef.current = INITIAL_RETRY_DELAY_MS;
          }
        });
      }, retryDelayRef.current);
    }

    scheduleRetry();

    return clearRetryTimer;
  }, [
    enabled,
    sandboxRecordId,
    effectiveStatus,
    reconcileHealth,
    clearRetryTimer,
  ]);

  useEffect(() => {
    disposedRef.current = false;

    return () => {
      disposedRef.current = true;
      clearRetryTimer();
    };
  }, [clearRetryTimer]);

  return { status: effectiveStatus, reconcileHealth };
}
