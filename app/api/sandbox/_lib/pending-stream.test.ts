import { afterEach, describe, expect, it, vi } from "vitest";
import { SANDBOX_READINESS_WAIT_HEADER } from "@/lib/sandbox/readiness-contract";
import { SANDBOX_READINESS_TIMEOUT_MS } from "@/lib/sandbox/wait-for-readiness";
import type { SandboxRecordRow } from "@/lib/types";
import { maxDuration } from "../route";
import {
  buildConcurrentSandboxLaunchResponse,
  maybeReturnExistingSandboxResponse,
} from "./launch";
import { buildPendingSandboxWaitStreamResponse } from "./pending-stream";
import { sandboxRecord } from "@/lib/sandbox/test-fixtures";
import { buildSandboxCleanupRecoveryStreamResponse } from "./cleanup-stream";

const record = {
  id: "sandbox-record-1",
  user_id: "user-1",
  repo_id: "repo-1",
  sandbox_id: "sandbox-runtime-1",
  base_branch: "main",
  working_branch: "main",
  limit_claim_id: null,
  status: "installing",
  preview_url: null,
  snapshot_id: null,
  error: null,
  created_at: "2026-08-20T12:00:00.000Z",
  last_active_at: "2026-08-20T12:00:00.000Z",
} satisfies SandboxRecordRow;

const pendingDeps = {
  getActiveSandboxForRepo: async () => record,
  resolveActiveSandboxState: async () => ({ kind: "pending" }),
  waitForSandboxReadiness: async () => ({
    kind: "ready",
    snapshot: {
      id: record.id,
      user_id: "user-1",
      status: "running",
    },
  }),
} as never;

const launch = {
  repoId: "repo-1",
  creds: { userId: "user-1" },
  launchRequest: { workingBranch: "main" },
  effectiveRootDirectory: null,
  productTeamId: null,
} as never;

describe("pending sandbox readiness stream", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("keeps the route budget above the readiness wait ceiling", () => {
    expect(maxDuration * 1000).toBeGreaterThan(SANDBOX_READINESS_TIMEOUT_MS);
    expect(maxDuration).toBeLessThanOrEqual(800);
  });

  it("uses the readiness stream only for an explicit internal opt-in", async () => {
    const response = await maybeReturnExistingSandboxResponse(
      pendingDeps,
      launch,
      new Request("http://localhost/api/sandbox", {
        headers: {
          Accept: "text/event-stream, application/json",
          [SANDBOX_READINESS_WAIT_HEADER]: "1",
        },
      })
    );

    expect(response?.headers.get("Content-Type")).toBe("text/event-stream");
    expect(await response?.text()).toContain('"type":"ready"');
  });

  it("keeps pending reuse JSON-compatible when only Accept requests SSE", async () => {
    const response = await maybeReturnExistingSandboxResponse(
      pendingDeps,
      launch,
      new Request("http://localhost/api/sandbox", {
        headers: { Accept: "text/event-stream, application/json" },
      })
    );

    expect(response?.headers.get("Content-Type")).toContain("application/json");
    await expect(response?.json()).resolves.toHaveProperty(
      "sandbox.runtime_summary.status",
      "installing"
    );
  });

  it("keeps an active cleanup collision pending until a fresh request resumes", async () => {
    const cleanupRecord = { ...record, status: "running" };
    const response = await maybeReturnExistingSandboxResponse(
      {
        getActiveSandboxForRepo: async () => cleanupRecord,
        resolveActiveSandboxState: async () => ({
          kind: "cleanup_pending",
        }),
        waitForSandboxReadiness: async () => ({
          kind: "ready",
          snapshot: {
            id: cleanupRecord.id,
            user_id: cleanupRecord.user_id,
            status: "running",
          },
        }),
        waitForSandboxCleanup: async () => ({
          kind: "complete",
          snapshot: {
            id: cleanupRecord.id,
            user_id: cleanupRecord.user_id,
            status: "stopped",
          },
        }),
        recordSandboxLifecycleEvent: async () => null,
      } as never,
      launch,
      new Request("http://localhost/api/sandbox")
    );

    expect(response?.headers.get("Content-Type")).toBe("text/event-stream");
    const body = await response?.text();
    expect(body).toContain("Waiting for previous sandbox cleanup");
    expect(body).toContain("Previous sandbox cleanup finished");
    expect(body).toContain('"type":"resume_required"');
    expect(body).not.toContain('"type":"ready"');
  });

  it("holds a reused launch open until Neon reports it ready", async () => {
    const response = buildPendingSandboxWaitStreamResponse({
      record,
      userId: "user-1",
      requestSignal: new AbortController().signal,
      waitForReadiness: async () => ({
        kind: "ready",
        snapshot: {
          id: record.id,
          user_id: "user-1",
          status: "running",
          health_status: "running",
          preview_url: "https://preview.example",
        },
      }),
    });

    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(response.headers.get("Connection")).toBeNull();
    const body = await response.text();
    expect(body).toContain('"type":"sandbox_created"');
    expect(body).toContain('"type":"ready"');
    expect(body).toContain('"status":"running"');
  });

  it("joins a concurrent pending insert through the readiness stream", async () => {
    const response = buildConcurrentSandboxLaunchResponse({
      deps: pendingDeps,
      record: record as never,
      userId: "user-1",
      request: new Request("http://localhost/api/sandbox"),
    });

    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    const body = await response.text();
    expect(body).toContain('"type":"sandbox_created"');
    expect(body).toContain('"type":"ready"');
  });

  it("clears stale health diagnostics from a recovered ready sandbox", async () => {
    const response = buildPendingSandboxWaitStreamResponse({
      record: {
        ...record,
        health_status: "app_error",
        last_boot_error: "stale boot failure",
      },
      userId: "user-1",
      requestSignal: new AbortController().signal,
      waitForReadiness: async () => ({
        kind: "ready",
        snapshot: {
          id: record.id,
          user_id: "user-1",
          status: "running",
        },
      }),
    });

    const body = await response.text();
    const readyEvent = body
      .split("\n")
      .find((line) => line.includes('"type":"ready"'));
    expect(readyEvent).toBeDefined();
    expect(readyEvent).not.toContain("stale boot failure");
    expect(readyEvent).not.toContain('"health_status":"app_error"');
  });

  it("emits an error instead of readiness when the sandbox stops", async () => {
    const response = buildPendingSandboxWaitStreamResponse({
      record,
      userId: "user-1",
      requestSignal: new AbortController().signal,
      waitForReadiness: async () => ({
        kind: "failed",
        message: "Sandbox stopped before it became ready.",
      }),
    });

    const body = await response.text();
    expect(body).toContain('"type":"error"');
    expect(body).not.toContain('"type":"ready"');
  });

  it("keeps readiness exceptions private while returning a safe error", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = buildPendingSandboxWaitStreamResponse({
      record,
      userId: "user-1",
      requestSignal: new AbortController().signal,
      waitForReadiness: async () => {
        throw new Error("private database detail");
      },
    });

    const body = await response.text();
    expect(body).toContain("Failed to wait for sandbox readiness.");
    expect(body).not.toContain("private database detail");
    expect(log).toHaveBeenCalledWith(
      "[sandbox] readiness wait failed",
      expect.any(Error)
    );
  });

  it("closes with a safe reconnect warning after a retryable Neon interruption", async () => {
    const response = buildPendingSandboxWaitStreamResponse({
      record,
      userId: "user-1",
      requestSignal: new AbortController().signal,
      waitForReadiness: async () => ({
        kind: "retry",
        message:
          "Sandbox readiness connection was interrupted. Reconnect to continue waiting.",
      }),
    });

    const body = await response.text();
    expect(body).toContain('"type":"sandbox_created"');
    expect(body).toContain('"type":"warning"');
    expect(body).not.toContain('"type":"error"');
  });

  it("emits transport keepalives while readiness remains event-driven", async () => {
    vi.useFakeTimers();
    let reportReady!: (result: {
      kind: "ready";
      snapshot: { id: string; user_id: string; status: string };
    }) => void;
    const readiness = new Promise<{
      kind: "ready";
      snapshot: { id: string; user_id: string; status: string };
    }>((resolve) => {
      reportReady = resolve;
    });
    const response = buildPendingSandboxWaitStreamResponse({
      record,
      userId: "user-1",
      requestSignal: new AbortController().signal,
      waitForReadiness: async () => readiness,
    });
    const reader = response.body!.getReader();

    await reader.read();
    const heartbeat = reader.read();
    await vi.advanceTimersByTimeAsync(25_000);
    const chunk = await heartbeat;

    expect(new TextDecoder().decode(chunk.value)).toBe(": ping\n\n");
    reportReady({
      kind: "ready",
      snapshot: { id: record.id, user_id: "user-1", status: "running" },
    });
    await reader.cancel();
  });
});

describe("sandbox cleanup recovery stream", () => {
  it("shows the pending phase, records timing, and requests a fresh invocation", async () => {
    const cleanupRecord = sandboxRecord({
      status: "running",
      persistent: true,
    });
    const lifecycleEvents: Array<Record<string, unknown>> = [];
    const times = [1_000, 3_500, 3_500, 3_500];
    const response = buildSandboxCleanupRecoveryStreamResponse({
      record: cleanupRecord,
      repoId: cleanupRecord.repo_id,
      userId: cleanupRecord.user_id,
      requestSignal: new AbortController().signal,
      waitForCleanup: async () => ({
        kind: "complete",
        snapshot: {
          id: cleanupRecord.id,
          user_id: cleanupRecord.user_id,
          status: "paused",
        },
      }),
      recordLifecycleEvent: async (event) => {
        lifecycleEvents.push(event as unknown as Record<string, unknown>);
        return "event-1";
      },
      nowMs: () => times.shift() ?? 3_500,
    });

    const body = await response.text();

    expect(response.headers.get("X-Mogplex-Sandbox-Lifecycle-Operation")).toBe(
      cleanupRecord.id
    );
    expect(body).toContain("Waiting for previous sandbox cleanup");
    expect(body).toContain("Previous sandbox cleanup finished after 3s");
    expect(body).toContain('"type":"resume_required"');
    expect(body).not.toContain('"type":"ready"');
    expect(lifecycleEvents).toEqual([
      expect.objectContaining({ eventType: "start_waiting_cleanup" }),
      expect.objectContaining({
        eventType: "start_cleanup_recovered",
        payload: expect.objectContaining({ duration_ms: 2_500 }),
      }),
    ]);
  });

  it("surfaces an actionable terminal state only after recovery times out", async () => {
    const cleanupRecord = sandboxRecord({
      status: "running",
      persistent: true,
    });
    const response = buildSandboxCleanupRecoveryStreamResponse({
      record: cleanupRecord,
      repoId: cleanupRecord.repo_id,
      userId: cleanupRecord.user_id,
      requestSignal: new AbortController().signal,
      waitForCleanup: async () => ({
        kind: "failed",
        message:
          "Sandbox cleanup did not finish automatically. Stop or delete the previous sandbox, then retry.",
      }),
      recordLifecycleEvent: async () => "event-1",
    });

    const body = await response.text();
    expect(body).toContain('"phase":"cleanup"');
    expect(body).toContain("Stop or delete the previous sandbox, then retry");
  });

  it("emits a persisted record marker for one service-restart reattach", async () => {
    const cleanupRecord = sandboxRecord({
      status: "running",
      persistent: true,
    });
    const response = buildSandboxCleanupRecoveryStreamResponse({
      record: cleanupRecord,
      repoId: cleanupRecord.repo_id,
      userId: cleanupRecord.user_id,
      requestSignal: new AbortController().signal,
      waitForCleanup: async () => ({
        kind: "retry",
        message:
          "Sandbox cleanup connection was interrupted. Reconnect to continue waiting.",
      }),
      recordLifecycleEvent: async () => "event-1",
    });

    const body = await response.text();
    expect(body).toContain('"type":"sandbox_created"');
    expect(body).toContain('"type":"warning"');
    expect(body).not.toContain('"type":"error"');
  });
});
