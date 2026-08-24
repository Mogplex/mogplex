import assert from "node:assert/strict";
import test from "node:test";
import { consumeSandboxLaunchResponse } from "../../lib/mogplex-api/sandbox-launch";

test("sandbox launch response asks API clients to retry after cleanup", async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(
          `data: ${JSON.stringify({
            type: "resume_required",
            reason: "cleanup_recovered",
          })}\n\n`
        )
      );
      controller.close();
    },
  });

  const result = await consumeSandboxLaunchResponse(
    new Response(body, { headers: { "content-type": "text/event-stream" } })
  );

  assert.deepEqual(result, {
    ok: false,
    status: 409,
    error: "Sandbox cleanup finished. Retry the launch.",
  });
});
