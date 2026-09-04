import assert from "node:assert/strict";
import test from "node:test";
import {
  buildResumeContinuePrompt,
  resumeExternalAgentRun,
} from "../../lib/mogplex-api/run-resume";
import type { ExternalAgentRunRow } from "../../lib/mogplex-api/runs";
import { buildAiCall, buildRunRow } from "./helpers/mogplex-api-runs-fixtures";

type LaunchArg = ExternalAgentRunRow;

function baseDeps(overrides: Record<string, unknown> = {}) {
  return {
    createAiCall: async () => buildAiCall({ id: "call-2", status: "pending" }),
    launchSandbox: async () => ({
      recordId: "sandbox-record-2",
      sandboxId: "sbx_456",
    }),
    runHarness: async () => ({ output: "" }),
    loadAiCall: async () => buildAiCall({ id: "call-2", status: "success" }),
    appendEvent: async () => null,
    notifyRunReachedTerminalState: async () => {},
    notifyRunCheckpoint: async () => {},
    ...overrides,
  };
}

test("buildResumeContinuePrompt reconciles the branch, carries the steer, and includes the protocol", () => {
  const prompt = buildResumeContinuePrompt(
    buildRunRow({ working_branch: "mogplex/external/feature" }),
    "  make the header smaller  "
  );
  assert.match(prompt, /mogplex\/external\/feature/);
  assert.match(prompt, /git fetch origin/);
  assert.match(prompt, /make the header smaller/);
  // steer is trimmed
  assert.doesNotMatch(prompt, / {2}make the header smaller/);
  // the checkpoint protocol is appended so the segment can pause again or ship
  assert.match(prompt, /<<<MOGPLEX_CHECKPOINT>>>/);
});

test("resumeExternalAgentRun returns not_found for a missing run", async () => {
  const result = await resumeExternalAgentRun(
    { runId: "missing", userId: "user-123", steer: "go" },
    { ...baseDeps(), loadRun: async () => null }
  );
  assert.equal(result.success, false);
  assert.equal(result.status, "not_found");
});

test("resumeExternalAgentRun refuses a run that is not awaiting input", async () => {
  let created = false;
  const result = await resumeExternalAgentRun(
    { runId: "run-1", userId: "user-123", steer: "go" },
    {
      ...baseDeps({
        createAiCall: async () => {
          created = true;
          return buildAiCall();
        },
      }),
      loadRun: async () => buildRunRow({ status: "streaming" }),
    }
  );
  assert.equal(result.success, false);
  assert.equal(result.status, "streaming");
  assert.match(result.error ?? "", /not awaiting input/);
  assert.equal(created, false);
});

test("resumeExternalAgentRun runs a fresh segment from the committed branch", async () => {
  let currentRun = buildRunRow({
    status: "awaiting_input",
    ai_call_id: "call-1",
    sandbox_record_id: "dead-record",
    sandbox_id: "dead-sbx",
    create_branch: true,
  });
  const updates: Array<Partial<ExternalAgentRunRow>> = [];
  let createdMetadata: Record<string, unknown> | undefined;
  let launchedWith: LaunchArg | null = null;
  let harnessRunWith: LaunchArg | null = null;

  const result = await resumeExternalAgentRun(
    { runId: "run-1", userId: "user-123", steer: "shrink the header" },
    {
      ...baseDeps(),
      loadRun: async () => currentRun,
      createAiCall: async (input) => {
        createdMetadata = input.metadata;
        assert.equal(input.status, "pending");
        return buildAiCall({ id: "call-2", status: "pending" });
      },
      updateRun: async (_userId, _runId, update) => {
        updates.push(update);
        currentRun = { ...currentRun, ...update };
        return currentRun;
      },
      launchSandbox: async (run) => {
        launchedWith = run;
        return { recordId: "sandbox-record-2", sandboxId: "sbx_456" };
      },
      runHarness: async (run) => {
        harnessRunWith = run;
        return { output: "" };
      },
      loadAiCall: async () => buildAiCall({ id: "call-2", status: "success" }),
    }
  );

  assert.equal(result.success, true);
  assert.equal(result.status, "success");

  // New segment ai_call is created, pinned external-api, and linked to the old.
  assert.equal(createdMetadata?.source, "external-api");
  assert.equal(createdMetadata?.resumed_from_ai_call_id, "call-1");

  // Run is repointed at the new segment and the dead sandbox is cleared.
  const repoint = updates[0];
  assert.equal(repoint.ai_call_id, "call-2");
  assert.equal(repoint.sandbox_record_id, null);
  assert.equal(repoint.sandbox_id, null);
  assert.equal(repoint.status, "streaming");

  // The launch uses a fresh checkout of the existing working branch.
  assert.ok(launchedWith);
  assert.equal((launchedWith as LaunchArg).create_branch, false);
  assert.equal((launchedWith as LaunchArg).sandbox_record_id, null);
  assert.match((launchedWith as LaunchArg).prompt, /git fetch origin/);

  // The harness runs against the segment's own ai_call and new sandbox.
  assert.ok(harnessRunWith);
  assert.equal((harnessRunWith as LaunchArg).ai_call_id, "call-2");
  assert.equal(
    (harnessRunWith as LaunchArg).sandbox_record_id,
    "sandbox-record-2"
  );

  // Final state persisted: new sandbox refs, then success.
  assert.equal(currentRun.sandbox_record_id, "sandbox-record-2");
  assert.equal(currentRun.status, "success");
});

test("resumeExternalAgentRun pauses again when the segment declares a checkpoint", async () => {
  let currentRun = buildRunRow({ status: "awaiting_input" });
  const checkpoints: Array<string | null> = [];

  const result = await resumeExternalAgentRun(
    { runId: "run-1", userId: "user-123", steer: "one more tweak" },
    {
      ...baseDeps(),
      loadRun: async () => currentRun,
      updateRun: async (_userId, _runId, update) => {
        currentRun = { ...currentRun, ...update };
        return currentRun;
      },
      runHarness: async () => ({
        output:
          'ok\n<<<MOGPLEX_CHECKPOINT>>>\n{"previewUrl":"https://sb2.vercel.run","summary":"second pass"}\n<<<END_MOGPLEX_CHECKPOINT>>>',
      }),
      loadAiCall: async () => buildAiCall({ id: "call-2", status: "success" }),
      notifyRunCheckpoint: async (_run, checkpoint) => {
        checkpoints.push(checkpoint.previewUrl);
      },
    }
  );

  assert.equal(result.status, "awaiting_input");
  assert.equal(currentRun.status, "awaiting_input");
  assert.deepEqual(checkpoints, ["https://sb2.vercel.run"]);
});

test("resumeExternalAgentRun records a failed segment launch", async () => {
  let currentRun = buildRunRow({ status: "awaiting_input" });
  const failedEvents: unknown[] = [];

  const result = await resumeExternalAgentRun(
    { runId: "run-1", userId: "user-123", steer: "go" },
    {
      ...baseDeps(),
      loadRun: async () => currentRun,
      updateRun: async (_userId, _runId, update) => {
        currentRun = { ...currentRun, ...update };
        return currentRun;
      },
      launchSandbox: async () => {
        throw new Error("boot limit reached");
      },
      appendEvent: async (event) => {
        failedEvents.push(event);
        return null;
      },
    }
  );

  assert.equal(result.success, false);
  assert.equal(result.status, "failed");
  assert.equal(result.error, "boot limit reached");
  assert.equal(currentRun.status, "failed");
  assert.equal(failedEvents.length, 1);
});
