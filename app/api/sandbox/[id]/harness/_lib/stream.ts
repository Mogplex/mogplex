import type { loadOwnedAiCall } from "@/lib/interactive-runs";
import { MAX_LOG_EVENT_LENGTH } from "./types";

/**
 * Truncates a log event to the maximum allowed length, appending a
 * truncation notice if the value exceeded the limit.
 */
export function truncateLogEvent(value: string): string {
  if (value.length <= MAX_LOG_EVENT_LENGTH) return value;
  return `${value.slice(0, MAX_LOG_EVENT_LENGTH)}\n...[truncated ${value.length - MAX_LOG_EVENT_LENGTH} chars]`;
}

/**
 * Detects errors that indicate the sandbox stream was closed unexpectedly.
 * Used for lifecycle reconciliation when the VM disappears mid-run.
 */
export function isClosedSandboxStreamError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /sandbox stream was closed|not accepting commands|sandbox.*(?:stopped|gone)|session.*(?:stopped|gone)/i.test(
    message
  );
}

/**
 * Checks whether the AI call has been marked for cancellation.
 */
export function isCancellationRequested(
  call: Awaited<ReturnType<typeof loadOwnedAiCall>> | null
): boolean {
  return (
    call?.control_state === "cancel_requested" ||
    call?.control_state === "cancelled" ||
    call?.status === "cancelled"
  );
}

/**
 * Builds a minimal SSE response for early-exit scenarios (e.g., prepareOnly,
 * pre-run cancellation). Sends the ai_call_id, optional install logs, and
 * optional cancellation signal.
 */
export function buildHarnessStreamResponse(input: {
  aiCallId: string;
  installLogs?: string;
  cancelRequested?: boolean;
}): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ type: "run", ai_call_id: input.aiCallId })}\n\n`
        )
      );

      if (input.installLogs) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "install", data: input.installLogs })}\n\n`
          )
        );
      }

      if (input.cancelRequested) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "cancelled" })}\n\n`)
        );
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
