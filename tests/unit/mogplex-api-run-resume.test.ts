import assert from "node:assert/strict";
import test from "node:test";
import { resumeExternalAgentRun } from "../../lib/mogplex-api/run-resume";
import type { ExternalAgentRunRow } from "../../lib/mogplex-api/runs";
import { buildAiCall, buildRunRow } from "./helpers/mogplex-api-runs-fixtures";

function pausedRun(overrides: Partial<ExternalAgentRunRow> = {}) {
  return buildRunRow({
    status: "awaiting_input",
    sandbox_record_id: "sandbox-record-1",
    sandbox_id: "sbx_123",
    ai_call_id: "call-old",
    harness_session_id: "sess-1",
    ...overrides,
  });
}

const CHECKPOINT_OUTPUT =
  'ok\n<<<MOGPLEX_CHECKPOINT>>>\n{"previewUrl":"https://sb.vercel.run","summary":"more"}\n<<<END_MOGPLEX_CHECKPOINT>>>';

test("resumeExternalAgentRun starts a new segment on the warm sandbox and finishes", async () => {
  let currentRun = pausedRun();
  const updates: Array<Partial<ExternalAgentRunRow>> = [];
  const resumeCalls: Array<{ recordId: string; message: string }> = [];

  const result = await resumeExternalAgentRun(
    { runId: "run-1", userId: "user-123", message: "ship it" },
    {
      loadRun: async () => currentRun,
      updateRun: async (_userId, _runId, update) => {
        updates.push(update);
        currentRun = { ...currentRun, ...update };
        return currentRun;
      },
      prepareAiCall: async (run, message) => {
        assert.equal(run.id, "run-1");
        assert.equal(message, "ship it");
        return "call-new";
      },
      resumeHarness: async (run, sandbox, message) => {
        resumeCalls.push({ recordId: sandbox.recordId, message });
        assert.equal(run.ai_call_id, "call-new");
        return { output: "done", sessionId: "sess-1" };
      },
      loadAiCall: async () => buildAiCall({ status: "success" }),
      appendEvent: async () => null,
      notifyRunReachedTerminalState: async () => {},
      notifyRunCheckpoint: async () => {
        throw new Error("should not checkpoint");
      },
    }
  );

  assert.equal(result.success, true);
  assert.equal(result.status, "success");
  assert.deepEqual(resumeCalls, [
    { recordId: "sandbox-record-1", message: "ship it" },
  ]);
  assert.deepEqual(
    updates.map((u) => u.status),
    ["streaming", "success"]
  );
  // The run points at the new segment's ai_call.
  assert.equal(updates[0].ai_call_id, "call-new");
});

test("resumeExternalAgentRun can pause again at a new checkpoint", async () => {
  let currentRun = pausedRun();
  const checkpoints: string[] = [];

  const result = await resumeExternalAgentRun(
    { runId: "run-1", userId: "user-123", message: "keep going" },
    {
      loadRun: async () => currentRun,
      updateRun: async (_userId, _runId, update) => {
        currentRun = { ...currentRun, ...update };
        return currentRun;
      },
      prepareAiCall: async () => "call-new",
      resumeHarness: async () => ({
        output: CHECKPOINT_OUTPUT,
        sessionId: "sess-1",
      }),
      loadAiCall: async () => buildAiCall({ status: "success" }),
      appendEvent: async () => null,
      notifyRunReachedTerminalState: async () => {
        throw new Error("should not finalize terminal");
      },
      notifyRunCheckpoint: async (_run, checkpoint) => {
        checkpoints.push(checkpoint.previewUrl ?? "");
      },
    }
  );

  assert.equal(result.status, "awaiting_input");
  assert.equal(currentRun.status, "awaiting_input");
  assert.deepEqual(checkpoints, ["https://sb.vercel.run"]);
});

test("resumeExternalAgentRun is a no-op for a run that is not awaiting input", async () => {
  const run = buildRunRow({ status: "success" });
  let prepared = false;

  const result = await resumeExternalAgentRun(
    { runId: "run-1", userId: "user-123", message: "hi" },
    {
      loadRun: async () => run,
      updateRun: async () => {
        throw new Error("updateRun should not run");
      },
      prepareAiCall: async () => {
        prepared = true;
        return "call-new";
      },
      resumeHarness: async () => ({ output: "", sessionId: null }),
      loadAiCall: async () => buildAiCall({ status: "success" }),
      appendEvent: async () => null,
      notifyRunReachedTerminalState: async () => {},
      notifyRunCheckpoint: async () => {},
    }
  );

  assert.equal(result.status, "success");
  assert.equal(prepared, false);
});

test("resumeExternalAgentRun fails cleanly when the sandbox is gone", async () => {
  let currentRun = pausedRun({ sandbox_id: null });
  let notifiedFailed = false;

  const result = await resumeExternalAgentRun(
    { runId: "run-1", userId: "user-123", message: "go" },
    {
      loadRun: async () => currentRun,
      updateRun: async (_userId, _runId, update) => {
        currentRun = { ...currentRun, ...update };
        return currentRun;
      },
      prepareAiCall: async () => {
        throw new Error("prepareAiCall should not run without a sandbox");
      },
      resumeHarness: async () => ({ output: "", sessionId: null }),
      loadAiCall: async () => buildAiCall(),
      appendEvent: async () => null,
      notifyRunReachedTerminalState: async (_run, status) => {
        if (status === "failed") notifiedFailed = true;
      },
      notifyRunCheckpoint: async () => {},
    }
  );

  assert.equal(result.status, "failed");
  assert.equal(currentRun.status, "failed");
  assert.equal(notifiedFailed, true);
});

test("resumeExternalAgentRun records failed resumes on the run and ai_call events", async () => {
  let currentRun = pausedRun();
  const failedEvents: unknown[] = [];

  const result = await resumeExternalAgentRun(
    { runId: "run-1", userId: "user-123", message: "go" },
    {
      loadRun: async () => currentRun,
      updateRun: async (_userId, _runId, update) => {
        currentRun = { ...currentRun, ...update };
        return currentRun;
      },
      prepareAiCall: async () => "call-new",
      resumeHarness: async () => {
        throw new Error("harness exploded");
      },
      loadAiCall: async () => buildAiCall(),
      appendEvent: async (event) => {
        failedEvents.push(event);
        return null;
      },
      notifyRunReachedTerminalState: async () => {},
      notifyRunCheckpoint: async () => {},
    }
  );

  assert.equal(result.success, false);
  assert.equal(result.status, "failed");
  assert.equal(result.error, "harness exploded");
  assert.equal(currentRun.status, "failed");
  assert.equal(failedEvents.length, 1);
});

test("resumeExternalAgentRun leaves the run paused on an empty reply", async () => {
  const run = pausedRun();
  let prepared = false;

  const result = await resumeExternalAgentRun(
    { runId: "run-1", userId: "user-123", message: "   " },
    {
      loadRun: async () => run,
      updateRun: async () => {
        throw new Error("updateRun should not run");
      },
      prepareAiCall: async () => {
        prepared = true;
        return "call-new";
      },
      resumeHarness: async () => ({ output: "", sessionId: null }),
      loadAiCall: async () => buildAiCall(),
      appendEvent: async () => null,
      notifyRunReachedTerminalState: async () => {},
      notifyRunCheckpoint: async () => {},
    }
  );

  assert.equal(result.status, "awaiting_input");
  assert.equal(prepared, false);
});
