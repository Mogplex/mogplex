/** Transport-only SSE heartbeat; never polls state or renews an execution lease. */
export function withChatStreamKeepalive(response: Response): Response {
  if (!response.body) return response;
  const reader = response.body.getReader();
  const encoder = new TextEncoder();
  let closed = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const clear = () => {
    if (timer) clearInterval(timer);
    timer = undefined;
  };
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      timer = setInterval(() => {
        if (!closed && (controller.desiredSize ?? 0) > 0) {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        }
      }, 15_000);
      timer.unref?.();
    },
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (closed) return;
        if (!chunk.done) {
          controller.enqueue(chunk.value);
          return;
        }
        closed = true;
        clear();
        reader.releaseLock();
        controller.close();
      } catch (error) {
        if (closed) return;
        closed = true;
        clear();
        reader.releaseLock();
        controller.error(error);
      }
    },
    async cancel(reason) {
      if (closed) return;
      closed = true;
      clear();
      try {
        await reader.cancel(reason);
      } finally {
        reader.releaseLock();
      }
    },
  });
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.set("cache-control", "no-cache, no-transform");
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
