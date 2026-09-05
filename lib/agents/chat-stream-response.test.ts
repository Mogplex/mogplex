import { afterEach, expect, it, vi } from "vitest";
import { withChatStreamKeepalive } from "./chat-stream-response";

afterEach(() => vi.useRealTimers());

it("does not drain provider output while a slow client stops reading", async () => {
  vi.useFakeTimers();
  let produced = 0;
  const response = withChatStreamKeepalive(
    new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          produced += 1;
          controller.enqueue(new TextEncoder().encode(`data: ${produced}\n\n`));
          if (produced === 100) controller.close();
        },
      })
    )
  );
  try {
    await vi.advanceTimersByTimeAsync(60_000);
    expect(produced).toBeLessThanOrEqual(3);
  } finally {
    // Do not let cleanup hide the backpressure assertion on a broken wrapper.
    await response.body!.cancel().catch(() => undefined);
  }
  expect(vi.getTimerCount()).toBe(0);
});

it("does not queue more heartbeats when the client is not reading", async () => {
  vi.useFakeTimers();
  const response = withChatStreamKeepalive(
    new Response(new ReadableStream<Uint8Array>())
  );
  const reader = response.body!.getReader();
  try {
    await vi.advanceTimersByTimeAsync(60_000);
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(
      ": keepalive\n\n"
    );
    let secondReadSettled = false;
    const second = reader.read().then((value) => {
      secondReadSettled = true;
      return value;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(secondReadSettled).toBe(false);
    await reader.cancel();
    expect((await second).done).toBe(true);
  } finally {
    await reader.cancel();
  }
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps quiet chat SSE alive, preserves protocol frames and headers, and clears its timer on completion", async () => {
  vi.useFakeTimers();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const source = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
    },
  });
  const response = withChatStreamKeepalive(
    new Response(source, {
      headers: {
        "content-type": "text/event-stream",
        "x-vercel-ai-ui-message-stream": "v1",
        "content-length": "0",
      },
    })
  );
  expect(response.headers.get("x-vercel-ai-ui-message-stream")).toBe("v1");
  expect(response.headers.get("content-length")).toBeNull();
  const reader = response.body!.getReader();
  await vi.advanceTimersByTimeAsync(15_000);
  expect(new TextDecoder().decode((await reader.read()).value)).toBe(
    ": keepalive\n\n"
  );
  controller.enqueue(new TextEncoder().encode('data: {"type":"finish"}\n\n'));
  controller.close();
  expect(new TextDecoder().decode((await reader.read()).value)).toContain(
    '"type":"finish"'
  );
  expect((await reader.read()).done).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it("cancels its source exactly once and stops heartbeats when the client cancels", async () => {
  vi.useFakeTimers();
  let cancellations = 0;
  const response = withChatStreamKeepalive(
    new Response(
      new ReadableStream({
        cancel() {
          cancellations += 1;
        },
      })
    )
  );
  await response.body!.cancel();
  expect(cancellations).toBe(1);
  expect(vi.getTimerCount()).toBe(0);
});

it("can discard buffered heartbeats after the source has already closed", async () => {
  vi.useFakeTimers();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const response = withChatStreamKeepalive(
    new Response(
      new ReadableStream<Uint8Array>({
        start(value) {
          controller = value;
        },
      })
    )
  );
  await vi.advanceTimersByTimeAsync(15_000);
  controller.close();
  await vi.advanceTimersByTimeAsync(0);
  await expect(response.body!.cancel()).resolves.toBeUndefined();
  expect(vi.getTimerCount()).toBe(0);
});

it("propagates stream failure and clears heartbeats", async () => {
  vi.useFakeTimers();
  const failure = new Error("disconnected");
  const response = withChatStreamKeepalive(
    new Response(
      new ReadableStream({
        start(controller) {
          controller.error(failure);
        },
      })
    )
  );
  await expect(response.text()).rejects.toBe(failure);
  expect(vi.getTimerCount()).toBe(0);
});
