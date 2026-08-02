export type SandboxLifecycleConflictEvent = {
  type: "cancelled";
  reason: "conflict";
  message: string;
};

export function buildLifecycleConflictResponse(message: string) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({
            type: "cancelled",
            reason: "conflict",
            message,
          } satisfies SandboxLifecycleConflictEvent)}\n\n`
        )
      );
      controller.close();
    },
  });

  return new Response(stream, {
    status: 409,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
