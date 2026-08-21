export type ControlStreamClosure = "complete" | "cancelled" | "error";

const CANCEL_HANDOFF_MS = 100;

async function waitForCancellationHandoff(cancellation: Promise<void>) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let cancellationError: unknown;
  const observedCancellation = cancellation.catch((error) => {
    cancellationError = error;
  });
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, CANCEL_HANDOFF_MS);
  });
  await Promise.race([observedCancellation, deadline]);
  if (timer) clearTimeout(timer);
  return cancellationError;
}

/** Run stream cleanup when the response closes, errors, or the client leaves. */
export function wrapControlResponseLifecycle(
  response: Response,
  onClose: (closure: ControlStreamClosure) => Promise<void>
): Response {
  let closeStarted = false;
  const closeOnce = async (closure: ControlStreamClosure, cause?: unknown) => {
    if (closeStarted) return;
    closeStarted = true;
    try {
      await onClose(closure);
    } catch (error) {
      console.error("[control/chat] stream lifecycle cleanup failed", {
        closure,
        error,
        cause,
      });
    }
  };

  if (!response.body) {
    void closeOnce("complete");
    return response;
  }

  const upstream = response.body.getReader();
  let cancelStarted = false;
  const readable = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await upstream.read();
        if (next.done && !cancelStarted) {
          controller.close();
          await closeOnce("complete");
        } else if (!next.done) {
          controller.enqueue(next.value);
        }
      } catch (error) {
        if (!cancelStarted) controller.error(error);
        await closeOnce(cancelStarted ? "cancelled" : "error", error);
      }
    },
    async cancel(reason) {
      cancelStarted = true;
      // Give AI SDK onAbort a bounded handoff window to publish its latest
      // in-flight steps. If teardown stalls, finalize from the latest completed
      // step instead of leaving the run streaming. This is a deadline, not polling.
      const cancellationError = await waitForCancellationHandoff(
        upstream.cancel(reason)
      );
      await closeOnce("cancelled", cancellationError ?? reason);
    },
  });

  return new Response(readable, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
