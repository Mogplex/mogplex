export type ControlStreamClosure = "complete" | "cancelled" | "error";

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
      // Invoke upstream cancellation first so AI SDK onAbort can publish its
      // latest in-flight steps before lifecycle finalization reads them. Do not
      // await teardown before recording cancellation; upstream teardown may hang.
      const cancellation = upstream.cancel(reason);
      const close = closeOnce("cancelled", reason);
      try {
        await cancellation;
      } finally {
        await close;
      }
    },
  });

  return new Response(readable, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
