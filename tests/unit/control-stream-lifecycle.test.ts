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
