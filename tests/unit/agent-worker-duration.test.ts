import assert from "node:assert/strict";
import test from "node:test";
import { timeout } from "@trigger.dev/sdk/v3";
import { AGENT_WORKER_TASK_OPTIONS } from "../../lib/trigger/agent-worker-duration";

test("agent workers are never stopped for running long", () => {
  assert.deepEqual(AGENT_WORKER_TASK_OPTIONS, {
    maxDuration: timeout.None,
    retry: { maxAttempts: 1 },
  });
});
