import { recordSandboxLifecycleEvent } from "@/lib/sandbox/auto-pause-presence";
import { toSandboxClientRecord } from "@/lib/sandbox/summary";
import { sseEncode } from "./utils";
import type { SandboxEvent } from "@/lib/sandbox/events";
import type { SandboxCleanupWaitResult } from "@/lib/sandbox/wait-for-readiness";
import type { SandboxRecord } from "@/lib/types";

type WaitForSandboxCleanup = (input: {
  sandboxRecordId: string;
  userId: string;
  signal?: AbortSignal;
}) => Promise<SandboxCleanupWaitResult>;

type SandboxClientRecordSource = Parameters<typeof toSandboxClientRecord>[0];

function normalizeClientRecord(
  record: SandboxClientRecordSource | SandboxRecord
) {
  return "runtime_summary" in record
    ? record
    : toSandboxClientRecord(record as SandboxClientRecordSource);
}

async function recordRecoveryEvent(
  input: Parameters<typeof recordSandboxLifecycleEvent>[0],
  recorder: typeof recordSandboxLifecycleEvent
) {
  try {
    await recorder(input);
  } catch (error) {
    console.warn("[sandbox/launch] Failed to persist lifecycle metric", {
      sandboxRecordId: input.sandboxRecordId,
      eventType: input.eventType,
      error,
    });
  }
}

/**
 * Keep the original launch request open while an owned stop/snapshot settles,
 * then hand the same request into launch again. Database notifications drive
 * the transition; the interval below is transport keepalive only.
 */
export function buildSandboxCleanupRecoveryStreamResponse(input: {
  record: SandboxClientRecordSource | SandboxRecord;
  repoId: string;
  userId: string;
  requestSignal: AbortSignal;
  waitForCleanup: WaitForSandboxCleanup;
  resumeLaunch: () => Promise<Response>;
  recordLifecycleEvent?: typeof recordSandboxLifecycleEvent;
  nowMs?: () => number;
}) {
  const encoder = new TextEncoder();
  const waitAbort = new AbortController();
  const operationId = input.record.id;
  const startedAtMs = (input.nowMs ?? Date.now)();
  const recorder = input.recordLifecycleEvent ?? recordSandboxLifecycleEvent;
  let cancelled = false;
  let keepalive: ReturnType<typeof setInterval> | null = null;

  const abortWait = () => waitAbort.abort(input.requestSignal.reason);
  if (input.requestSignal.aborted) abortWait();
  else input.requestSignal.addEventListener("abort", abortWait, { once: true });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: SandboxEvent) => {
        if (cancelled) return;
        controller.enqueue(encoder.encode(sseEncode(event)));
      };
      const elapsedMs = () =>
        Math.max(0, (input.nowMs ?? Date.now)() - startedAtMs);

      const waitingMessage =
        "Waiting for previous sandbox cleanup. Automatic recovery is running.";
      emit({
        type: "lifecycle",
        phase: "pending_cleanup",
        status: "waiting",
        sandboxId: input.record.sandbox_id,
        operationId,
        elapsedMs: 0,
        message: waitingMessage,
      });
      // A persisted record marker lets an agent caller reattach once if the
      // service or response stream is interrupted during cleanup.
      emit({
        type: "sandbox_created",
        sandboxId: input.record.sandbox_id,
        recordId: input.record.id,
        sandbox: normalizeClientRecord(input.record),
      });

      console.info("[sandbox/launch] cleanup recovery waiting", {
        repoId: input.repoId,
        sandboxRecordId: input.record.id,
        operationId,
      });
      await recordRecoveryEvent(
        {
          sandboxRecordId: input.record.id,
          userId: input.userId,
          eventType: "start_waiting_cleanup",
          payload: { operation_id: operationId, repo_id: input.repoId },
        },
        recorder
      );

      // Transport heartbeat only; lifecycle state remains notification driven.
      keepalive = setInterval(() => {
        if (cancelled) return;
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          cancelled = true;
          waitAbort.abort(new Error("Sandbox cleanup stream closed"));
        }
      }, 25_000);

      try {
        const result = await input.waitForCleanup({
          sandboxRecordId: input.record.id,
          userId: input.userId,
          signal: waitAbort.signal,
        });
        if (result.kind === "retry") {
          emit({ type: "warning", message: result.message });
          return;
        }
        if (result.kind === "failed") {
          const durationMs = elapsedMs();
          console.warn("[sandbox/launch] cleanup recovery failed", {
            repoId: input.repoId,
            sandboxRecordId: input.record.id,
            operationId,
            durationMs,
          });
          await recordRecoveryEvent(
            {
              sandboxRecordId: input.record.id,
              userId: input.userId,
              eventType: "start_cleanup_failed",
              payload: {
                operation_id: operationId,
                repo_id: input.repoId,
                duration_ms: durationMs,
                recovery: "manual_stop_or_delete",
              },
            },
            recorder
          );
          emit({ type: "error", message: result.message, phase: "cleanup" });
          return;
        }

        const durationMs = elapsedMs();
        const recoveredMessage = `Previous sandbox cleanup finished after ${Math.ceil(
          durationMs / 1000
        )}s. Starting sandbox.`;
        emit({
          type: "lifecycle",
          phase: "pending_cleanup",
          status: "recovered",
          sandboxId: input.record.sandbox_id,
          operationId,
          elapsedMs: durationMs,
          message: recoveredMessage,
        });
        console.info("[sandbox/launch] cleanup recovery completed", {
          repoId: input.repoId,
          sandboxRecordId: input.record.id,
          operationId,
          durationMs,
        });
        await recordRecoveryEvent(
          {
            sandboxRecordId: input.record.id,
            userId: input.userId,
            eventType: "start_cleanup_recovered",
            payload: {
              operation_id: operationId,
              repo_id: input.repoId,
              duration_ms: durationMs,
            },
          },
          recorder
        );

        const resumed = await input.resumeLaunch();
        const contentType = resumed.headers.get("Content-Type") ?? "";
        if (contentType.includes("text/event-stream") && resumed.body) {
          const reader = resumed.body.getReader();
          for (;;) {
            if (cancelled) break;
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
          return;
        }

        const payload = (await resumed.json().catch(() => ({}))) as {
          error?: unknown;
          sandbox?: unknown;
        };
        if (!resumed.ok || !payload.sandbox) {
          emit({
            type: "error",
            message:
              typeof payload.error === "string"
                ? payload.error
                : "Sandbox cleanup finished, but startup could not resume.",
            phase: "create",
          });
          return;
        }
        emit({ type: "ready", sandbox: payload.sandbox as never });
      } catch (error) {
        if (!waitAbort.signal.aborted) {
          console.error("[sandbox/launch] cleanup recovery crashed", error);
          emit({
            type: "error",
            message: "Sandbox cleanup recovery failed. Retry the launch.",
            phase: "cleanup",
          });
        }
      } finally {
        if (keepalive) clearInterval(keepalive);
        input.requestSignal.removeEventListener("abort", abortWait);
        if (!cancelled) controller.close();
      }
    },
    cancel() {
      cancelled = true;
      if (keepalive) clearInterval(keepalive);
      waitAbort.abort(new Error("Sandbox cleanup stream closed"));
      input.requestSignal.removeEventListener("abort", abortWait);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Mogplex-Sandbox-Lifecycle-Operation": operationId,
    },
  });
}
