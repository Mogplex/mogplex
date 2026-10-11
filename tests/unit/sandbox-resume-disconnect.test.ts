import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { loadSandboxResumeRouteModule } from "./sandbox-record-route-test-harness/loaders";
import {
  buildSandboxRouteParams,
  buildSandboxRouteRequest,
} from "./sandbox-record-route-test-harness";
import {
  buildLoadedResumeContext,
  buildPersistedResumeRecord,
  type ResumeRecord,
} from "./helpers/sandbox-resume-route-fixtures";

test("closing the readiness stream does not stop or fail the restored workspace", async () => {
  const { createSandboxResumeHandler } = await loadSandboxResumeRouteModule();
  const continueBootstrap = Promise.withResolvers<void>();
  const finishedBootstrap = Promise.withResolvers<void>();
  const statuses: string[] = [];
  let stops = 0;
  const handler = createSandboxResumeHandler({
    loadOwnedSandboxRouteContext: (async () =>
      buildLoadedResumeContext()) as never,
    enforceSandboxBootLimits: (async () => ({ allowed: true })) as never,
    getSandbox: (async () => ({
      stop: async () => {
        stops += 1;
      },
    })) as never,
    updateSandboxRecord: (async (
      _id: string,
      updates: Partial<ResumeRecord>
    ) => {
      if (updates.status) statuses.push(updates.status);
      return buildPersistedResumeRecord(updates);
    }) as never,
    resolveRepoSandboxEnv: (async () => ({
      envVars: {},
      sync: { mode: "sandbox-only" },
    })) as never,
    bootstrapFromSnapshotStreaming: async function* bootstrap() {
      try {
        yield { type: "status", status: "running" };
        await continueBootstrap.promise;
        yield { type: "log", phase: "dev", data: "Final startup log" };
      } finally {
        finishedBootstrap.resolve();
      }
    } as never,
  });
  const response = await handler(
    buildSandboxRouteRequest({ method: "POST", suffix: "/resume" }),
    buildSandboxRouteParams()
  );
  const reader = response.body!.getReader();
  let events = "";
  while (!events.includes('"type":"ready"')) {
    const chunk = await reader.read();
    assert.equal(chunk.done, false);
    events += new TextDecoder().decode(chunk.value);
  }
  await reader.cancel();
  continueBootstrap.resolve();
  await finishedBootstrap.promise;
  // Drain this event-loop turn, including the stream's completion/error path.
  await setImmediate();
  assert.equal(stops, 0);
  assert.deepEqual(statuses, ["installing", "running"]);
});
