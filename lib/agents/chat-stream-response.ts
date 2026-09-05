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
    async start(controller) {
      timer = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(": keepalive\n\n"));
      }, 15_000);
      timer.unref?.();
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done || closed) break;
          controller.enqueue(chunk.value);
        }
        if (!closed) controller.close();
      } catch (error) {
        if (!closed) controller.error(error);
      } finally {
        closed = true;
        clear();
        reader.releaseLock();
      }
    },
    async cancel(reason) {
      closed = true;
      clear();
      await reader.cancel(reason);
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
