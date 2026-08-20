import { toSandboxClientRecord } from "@/lib/sandbox/summary";
import { sseEncode } from "./utils";
import type { SandboxEvent } from "@/lib/sandbox/events";
import type {
  SandboxReadinessSnapshot,
  SandboxReadinessWaitResult,
} from "@/lib/sandbox/wait-for-readiness";

type WaitForSandboxReadiness = (input: {
  sandboxRecordId: string;
  userId: string;
  signal?: AbortSignal;
}) => Promise<SandboxReadinessWaitResult>;

type SandboxClientRecordSource = Parameters<typeof toSandboxClientRecord>[0];

function mergeReadinessSnapshot(
  record: SandboxClientRecordSource,
  snapshot: SandboxReadinessSnapshot
): SandboxClientRecordSource {
  return {
    ...record,
    status: "running",
    health_status: snapshot.health_status ?? record.health_status,
    preview_url: snapshot.preview_url ?? record.preview_url,
    error: snapshot.error ?? null,
    last_boot_error: snapshot.last_boot_error ?? record.last_boot_error,
  };
}

/** Stream a reused pending sandbox through its Neon-notified terminal state. */
export function buildPendingSandboxWaitStreamResponse(input: {
  record: SandboxClientRecordSource;
  userId: string;
  requestSignal: AbortSignal;
  waitForReadiness: WaitForSandboxReadiness;
}) {
  const encoder = new TextEncoder();
  const waitAbort = new AbortController();
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

      emit({
        type: "sandbox_created",
        sandboxId: input.record.sandbox_id,
        recordId: input.record.id,
        sandbox: toSandboxClientRecord(input.record),
      });

      // Transport heartbeat only; lifecycle state remains Neon-notification driven.
      keepalive = setInterval(() => {
        if (cancelled) return;
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          cancelled = true;
          waitAbort.abort(new Error("Sandbox readiness stream closed"));
        }
      }, 25_000);

      try {
        const result = await input.waitForReadiness({
          sandboxRecordId: input.record.id,
          userId: input.userId,
          signal: waitAbort.signal,
        });
        if (result.kind === "failed") {
          emit({ type: "error", message: result.message, phase: "create" });
        } else {
          emit({
            type: "ready",
            sandbox: toSandboxClientRecord(
              mergeReadinessSnapshot(input.record, result.snapshot)
            ),
          });
        }
      } catch (error) {
        if (!waitAbort.signal.aborted) {
          console.error("[sandbox] readiness wait failed", error);
          emit({
            type: "error",
            message: "Failed to wait for sandbox readiness.",
            phase: "create",
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
      waitAbort.abort(new Error("Sandbox readiness stream closed"));
      input.requestSignal.removeEventListener("abort", abortWait);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });
}
