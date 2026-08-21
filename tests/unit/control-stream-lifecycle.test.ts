import assert from "node:assert/strict";
import test from "node:test";
import { wrapControlResponseLifecycle } from "../../app/api/control/chat/_lib/stream-lifecycle";

test("control stream lifecycle reports client cancellation", async () => {
  const closures: string[] = [];
  let reportClosed!: () => void;
  const closed = new Promise<void>((resolve) => {
    reportClosed = resolve;
  });
  const upstream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("first"));
    },
  });
  const response = wrapControlResponseLifecycle(
    new Response(upstream),
    async (closure) => {
      closures.push(closure);
      reportClosed();
    }
  );
  const reader = response.body!.getReader();

  await reader.read();
  await reader.cancel("client left");
  await closed;

  assert.deepEqual(closures, ["cancelled"]);
});

test("control stream lifecycle reports a fully consumed response as complete", async () => {
  const closures: string[] = [];
  let reportClosed!: () => void;
  const closed = new Promise<void>((resolve) => {
    reportClosed = resolve;
  });
  const response = wrapControlResponseLifecycle(
    new Response("complete"),
    async (closure) => {
      closures.push(closure);
      reportClosed();
    }
  );

  await response.text();
  await closed;

  assert.deepEqual(closures, ["complete"]);
});

test("control stream lifecycle distinguishes an upstream error", async () => {
  const closures: string[] = [];
  let reportClosed!: () => void;
  const closed = new Promise<void>((resolve) => {
    reportClosed = resolve;
  });
  const upstream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(new Error("upstream failed"));
    },
  });
  const response = wrapControlResponseLifecycle(
    new Response(upstream),
    async (closure) => {
      closures.push(closure);
      reportClosed();
    }
  );

  await assert.rejects(response.text(), /upstream failed/);
  await closed;

  assert.deepEqual(closures, ["error"]);
});

test("control stream lifecycle records cancellation before upstream teardown", async () => {
  const closures: string[] = [];
  const order: string[] = [];
  let finishCancel!: () => void;
  const upstream = new ReadableStream<Uint8Array>({
    pull() {
      return new Promise(() => undefined);
    },
    cancel() {
      order.push("upstream-cancel");
      return new Promise<void>((resolve) => {
        finishCancel = resolve;
      });
    },
  });
  const response = wrapControlResponseLifecycle(
    new Response(upstream),
    async (closure) => {
      order.push("lifecycle-close");
      closures.push(closure);
    }
  );
  const reader = response.body!.getReader();
  void reader.read();

  const cancellation = reader.cancel("client left");
  await Promise.resolve();

  assert.deepEqual(closures, ["cancelled"]);
  assert.deepEqual(order, ["upstream-cancel", "lifecycle-close"]);
  finishCancel();
  await cancellation;
});

test("control stream lifecycle ignores a pending read rejection after cancellation", async () => {
  const closures: string[] = [];
  let rejectRead!: (error: Error) => void;
  let reportReadStarted!: () => void;
  const readStarted = new Promise<void>((resolve) => {
    reportReadStarted = resolve;
  });
  const upstreamReader = {
    read: () =>
      new Promise<ReadableStreamReadResult<Uint8Array>>((_, reject) => {
        rejectRead = reject;
        reportReadStarted();
      }),
    cancel: async () => rejectRead(new Error("read cancelled")),
  };
  const input = {
    body: { getReader: () => upstreamReader },
    headers: new Headers(),
    status: 200,
    statusText: "OK",
  } as unknown as Response;
  const response = wrapControlResponseLifecycle(input, async (closure) => {
    closures.push(closure);
  });
  const reader = response.body!.getReader();
  void reader.read();
  await readStarted;

  await reader.cancel("client left");

  assert.deepEqual(closures, ["cancelled"]);
});
