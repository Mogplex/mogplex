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
  const readable = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await upstream.read();
        if (next.done) {
          controller.close();
          await closeOnce("complete");
        } else {
          controller.enqueue(next.value);
        }
      } catch (error) {
        controller.error(error);
        await closeOnce("error", error);
      }
    },
    async cancel(reason) {
      try {
        await upstream.cancel(reason);
      } finally {
        await closeOnce("cancelled", reason);
      }
    },
  });

  return new Response(readable, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
