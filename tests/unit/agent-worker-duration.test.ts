import assert from "node:assert/strict";
import test from "node:test";
import { timeout } from "@trigger.dev/sdk/v3";
import { AGENT_WORKER_MAX_DURATION_SECONDS } from "../../lib/trigger/agent-worker-duration";

test("agent workers are never stopped for running long", () => {
  assert.equal(AGENT_WORKER_MAX_DURATION_SECONDS, timeout.None);
});
