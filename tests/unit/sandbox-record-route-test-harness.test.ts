import assert from "node:assert/strict";
import test from "node:test";
import { readStreamBody } from "./sandbox-record-route-test-harness";

test("readStreamBody flushes partial decoder state at end of stream", async () => {
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.from([226]));
        controller.enqueue(Uint8Array.from([130, 172]));
        controller.close();
      },
    })
  );

  assert.equal(await readStreamBody(response), String.fromCodePoint(8364));
});
