export type ControlStreamClosure = "complete" | "incomplete";

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

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  void response.body
    .pipeTo(writable)
    .then(() => closeOnce("complete"))
    .catch((error) => closeOnce("incomplete", error));

  return new Response(readable, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
