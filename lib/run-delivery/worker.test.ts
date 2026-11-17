import { expect, test } from "vitest";
import {
  resumeExternalAgentRun,
  queueResumeExternalAgentRun,
  type ResumeExternalAgentRunDeps,
} from "@/lib/mogplex-api/run-resume";
import { buildAiCall } from "@/tests/unit/helpers/mogplex-api-runs-fixtures";
import { deliveryRun } from "./fixtures.test-support";

function fixture() {
  let run = deliveryRun();
  let claimed = true;
  const launched: string[] = [];
  const cancelled: string[] = [];
  const refreshed: string[] = [];
  const deps: ResumeExternalAgentRunDeps = {
    loadRun: async () => run,
    updateRun: async (_user, _id, update) => {
      run = { ...run, ...update };
      return run;
    },
    createAiCall: async () => buildAiCall({ id: "call-2" }),
    loadAiCall: async () => buildAiCall({ id: "call-2", status: "success" }),
    appendEvent: async () => null,
    launchSandbox: async (value) => {
      expect(value.create_branch).toBe(false);
      expect(value.prompt).toContain("saved workspace");
      launched.push(value.ai_call_id);
      return { recordId: "saved-record", sandboxId: "saved-sandbox" };
    },
    runHarness: async (value) => {
      expect(value.prompt).toContain(
        "Do not ask for the same implementation approval"
      );
      return { output: "Fixed CI and pushed the same PR." };
    },
    recordTerminalCommit: async () => {},
    recordCheckpoint: async () => {},
    notifyRunCheckpoint: async () => {},
    notifyRunReachedTerminalState: async () => {},
    refreshDelivery: async (_user, id) => {
      refreshed.push(id);
    },
    delivery: {
      authorize: async (value) => value,
      claimCheckpoint: async (value) => value.run,
      prepare: async () => true,
      claim: async (value) => {
        if (!claimed) return null;
        run = {
          ...run,
          status: "streaming",
          ai_call_id: value.aiCallId,
          runtime_run_id: value.runtimeRunId,
        };
        return run;
      },
      cancelCall: async (id) => {
        cancelled.push(id);
      },
    },
  };
  return {
    deps,
    launched,
    cancelled,
    refreshed,
    run: () => run,
    loseClaim: () => {
      claimed = false;
    },
  };
}
const payload = {
  runId: "run-1",
  userId: "user-123",
  runtimeRunId: "worker-2",
  steer: "Fix the reported CI",
  mode: "delivery" as const,
  delivery: { headSha: "head-1", revision: "revision-1" },
};
test("repair resumes the saved workspace, binds the new worker and records delivery after completion", async () => {
  const f = fixture();
  const result = await resumeExternalAgentRun(payload, f.deps);
  expect(result.status).toBe("success");
  expect(f.launched).toEqual(["call-2"]);
  expect(f.run().runtime_run_id).toBe("worker-2");
  expect(f.refreshed).toEqual(["run-1"]);
});
test("a lost atomic claim cancels its orphan call without waking a workspace", async () => {
  const f = fixture();
  f.loseClaim();
  await resumeExternalAgentRun(payload, f.deps);
  expect(f.launched).toEqual([]);
  expect(f.cancelled).toEqual(["call-2"]);
});
test("stale queued checkpoints and stale repair evidence cannot create a segment", async () => {
  const f = fixture();
  let calls = 0;
  f.deps.createAiCall = async () => {
    calls++;
    return buildAiCall();
  };
  f.deps.delivery.prepare = async () => false;
  await resumeExternalAgentRun(payload, f.deps);
  f.run().status = "awaiting_input";
  await resumeExternalAgentRun(
    { ...payload, mode: "review", checkpointAiCallId: "earlier-call" },
    f.deps
  );
  expect(calls).toBe(0);
});
test("queue preserves checkpoint authority and repair identity on the existing per-run queue", async () => {
  const calls: unknown[] = [];
  await queueResumeExternalAgentRun(
    {
      ...payload,
      repoId: "repo-1",
      followThrough: true,
      checkpointAiCallId: "call-1",
      idempotencyKey: "once",
    },
    {
      isRuntimeConfigured: () => true,
      triggerTask: async (...args) => {
        calls.push(args);
        return { id: "worker" };
      },
    }
  );
  expect(calls[0]).toMatchObject([
    expect.any(String),
    {
      followThrough: true,
      checkpointAiCallId: "call-1",
      delivery: payload.delivery,
    },
    { concurrencyKey: "resume-agent-run:run-1", idempotencyKey: "once" },
  ]);
  await expect(
    queueResumeExternalAgentRun(
      { ...payload, repoId: "repo-1", idempotencyKey: "once" },
      { isRuntimeConfigured: () => false }
    )
  ).rejects.toThrow("not configured");
});
