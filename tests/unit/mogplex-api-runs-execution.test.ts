import assert from "node:assert/strict";
import test from "node:test";
import {
  buildExternalAgentHarnessRequestBody,
  executeExternalAgentRun,
} from "../../lib/mogplex-api/run-execution";
import type { ExternalAgentRunRow } from "../../lib/mogplex-api/runs";
import { buildAiCall, buildRunRow } from "./helpers/mogplex-api-runs-fixtures";

test("buildExternalAgentHarnessRequestBody carries Slack image attachment metadata", () => {
  const body = buildExternalAgentHarnessRequestBody(
    buildRunRow({
      metadata: {
        slack_image_attachments: {
          teamId: "T1",
          droppedCount: 1,
          files: [
            {
              id: "F1",
              mimetype: "image/png",
              urlPrivateDownload: "https://files.slack.com/files-pri/T-F1/png",
              name: "screenshot.png",
              sizeBytes: 123,
            },
            {
              id: "bad",
              mimetype: "application/pdf",
              urlPrivateDownload: "https://files.slack.com/files-pri/T-bad/pdf",
            },
          ],
        },
      },
    })
  );

  assert.deepEqual(body.slackImageAttachments, {
    teamId: "T1",
    droppedCount: 1,
    files: [
      {
        id: "F1",
        mimetype: "image/png",
        urlPrivateDownload: "https://files.slack.com/files-pri/T-F1/png",
        name: "screenshot.png",
        sizeBytes: 123,
      },
    ],
  });
});

test("executeExternalAgentRun launches the sandbox, runs the harness, and mirrors ai_call status", async () => {
  let currentRun = buildRunRow({
    sandbox_record_id: null,
    sandbox_id: null,
    create_branch: true,
  });
  const updates: Array<Partial<ExternalAgentRunRow>> = [];
  let harnessRan = false;

  const result = await executeExternalAgentRun(
    { runId: "run-1", userId: "user-123" },
    {
      loadRun: async () => currentRun,
      updateRun: async (userId, _runId, update) => {
        assert.equal(userId, "user-123");
        updates.push(update);
        currentRun = { ...currentRun, ...update };
        return currentRun;
      },
      launchSandbox: async (run) => {
        assert.equal(run.create_branch, true);
        return { recordId: "sandbox-record-1", sandboxId: "sbx_123" };
      },
      runHarness: async (run, sandbox) => {
        assert.equal(run.status, "streaming");
        assert.equal(sandbox.recordId, "sandbox-record-1");
        harnessRan = true;
        return { output: "" };
      },
      loadAiCall: async () => buildAiCall({ status: "success" }),
      appendEvent: async () => {
        throw new Error("appendEvent should not run on success");
      },
    }
  );

  assert.equal(result.success, true);
  assert.equal(result.status, "success");
  assert.equal(harnessRan, true);
  assert.deepEqual(
    updates.map((update) => update.status),
    ["streaming", "success"]
  );
  assert.equal(currentRun.sandbox_record_id, "sandbox-record-1");
  assert.equal(currentRun.sandbox_id, "sbx_123");
});

test("executeExternalAgentRun records failed launches on the run and ai_call events", async () => {
  let currentRun = buildRunRow();
  const failedEvents: Array<unknown> = [];

  const result = await executeExternalAgentRun(
    { runId: "run-1", userId: "user-123" },
    {
      loadRun: async () => currentRun,
      updateRun: async (userId, _runId, update) => {
        assert.equal(userId, "user-123");
        currentRun = { ...currentRun, ...update };
        return currentRun;
      },
      launchSandbox: async () => {
        throw new Error("Sandbox launch failed");
      },
      runHarness: async () => {
        throw new Error("runHarness should not run");
      },
      loadAiCall: async () => buildAiCall(),
      appendEvent: async (event) => {
        failedEvents.push(event);
        return null;
      },
    }
  );

  assert.equal(result.success, false);
  assert.equal(result.status, "failed");
  assert.equal(result.error, "Sandbox launch failed");
  assert.equal(currentRun.status, "failed");
  assert.equal(currentRun.error, "Sandbox launch failed");
  assert.equal(failedEvents.length, 1);
});

test("executeExternalAgentRun notifies the terminal-state hook on success and failure", async () => {
  const notified: Array<{ runId: string; status: string }> = [];
  const notify = async (
    run: { id: string; metadata: unknown },
    status: string
  ) => {
    notified.push({ runId: run.id, status });
  };

  await executeExternalAgentRun(
    { runId: "run-1", userId: "user-123" },
    {
      loadRun: async () => buildRunRow({ status: "pending" }),
      updateRun: async (_userId, _runId, update) => buildRunRow({ ...update }),
      launchSandbox: async () => ({
        recordId: "sandbox-record-1",
        sandboxId: "sbx_123",
      }),
      runHarness: async () => ({ output: "" }),
      loadAiCall: async () => buildAiCall({ status: "success" }),
      appendEvent: async () => null,
      notifyRunReachedTerminalState: notify,
    }
  );

  await executeExternalAgentRun(
    { runId: "run-1", userId: "user-123" },
    {
      loadRun: async () => buildRunRow({ status: "pending" }),
      updateRun: async (_userId, _runId, update) => buildRunRow({ ...update }),
      launchSandbox: async () => {
        throw new Error("boom");
      },
      runHarness: async () => ({ output: "" }),
      loadAiCall: async () => buildAiCall(),
      appendEvent: async () => null,
      notifyRunReachedTerminalState: notify,
    }
  );

  assert.deepEqual(notified, [
    { runId: "run-1", status: "success" },
    { runId: "run-1", status: "failed" },
  ]);
});

test("executeExternalAgentRun swallows a throwing terminal-state hook", async () => {
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const result = await executeExternalAgentRun(
      { runId: "run-1", userId: "user-123" },
      {
        loadRun: async () => buildRunRow({ status: "pending" }),
        updateRun: async (_userId, _runId, update) =>
          buildRunRow({ ...update }),
        launchSandbox: async () => ({
          recordId: "sandbox-record-1",
          sandboxId: "sbx_123",
        }),
        runHarness: async () => ({ output: "" }),
        loadAiCall: async () => buildAiCall({ status: "success" }),
        appendEvent: async () => null,
        notifyRunReachedTerminalState: async () => {
          throw new Error("slack down");
        },
      }
    );
    assert.equal(result.success, true);
    assert.equal(result.status, "success");
  } finally {
    console.warn = originalWarn;
  }
});

test("executeExternalAgentRun re-notifies when the run was already terminal", async () => {
  const notified: Array<{ runId: string; status: string }> = [];
  const result = await executeExternalAgentRun(
    { runId: "run-1", userId: "user-123" },
    {
      loadRun: async () => buildRunRow({ status: "success" }),
      updateRun: async () => {
        throw new Error("updateRun should not run for an already-terminal run");
      },
      launchSandbox: async () => {
        throw new Error("launchSandbox should not run");
      },
      runHarness: async () => ({ output: "" }),
      loadAiCall: async () => buildAiCall({ status: "success" }),
      appendEvent: async () => null,
      notifyRunReachedTerminalState: async (run, status) => {
        notified.push({ runId: run.id, status });
      },
    }
  );
  assert.equal(result.status, "success");
  assert.deepEqual(notified, [{ runId: "run-1", status: "success" }]);
});

test("executeExternalAgentRun pauses at a checkpoint instead of finishing", async () => {
  let currentRun = buildRunRow({ status: "pending" });
  const updates: Array<Partial<ExternalAgentRunRow>> = [];
  const checkpoints: Array<{ runId: string; previewUrl: string | null }> = [];
  let terminalNotified = false;

  const result = await executeExternalAgentRun(
    { runId: "run-1", userId: "user-123" },
    {
      loadRun: async () => currentRun,
      updateRun: async (_userId, _runId, update) => {
        updates.push(update);
        currentRun = { ...currentRun, ...update };
        return currentRun;
      },
      launchSandbox: async () => ({
        recordId: "sandbox-record-1",
        sandboxId: "sbx_123",
      }),
      runHarness: async () => ({
        output:
          'done\n<<<MOGPLEX_CHECKPOINT>>>\n{"previewUrl":"https://sb.vercel.run","summary":"moved sign in"}\n<<<END_MOGPLEX_CHECKPOINT>>>',
      }),
      loadAiCall: async () => buildAiCall({ status: "success" }),
      appendEvent: async () => null,
      notifyRunReachedTerminalState: async () => {
        terminalNotified = true;
      },
      notifyRunCheckpoint: async (run, checkpoint) => {
        checkpoints.push({
          runId: run.id,
          previewUrl: checkpoint.previewUrl,
        });
      },
    }
  );

  assert.equal(result.success, true);
  assert.equal(result.status, "awaiting_input");
  assert.equal(currentRun.status, "awaiting_input");
  assert.equal(terminalNotified, false);
  assert.deepEqual(checkpoints, [
    { runId: "run-1", previewUrl: "https://sb.vercel.run" },
  ]);
  assert.deepEqual(
    updates.map((update) => update.status),
    ["streaming", "awaiting_input"]
  );
});

test("executeExternalAgentRun ignores a checkpoint marker when the pass failed", async () => {
  let currentRun = buildRunRow({ status: "pending" });
  let checkpointNotified = false;

  const result = await executeExternalAgentRun(
    { runId: "run-1", userId: "user-123" },
    {
      loadRun: async () => currentRun,
      updateRun: async (_userId, _runId, update) => {
        currentRun = { ...currentRun, ...update };
        return currentRun;
      },
      launchSandbox: async () => ({
        recordId: "sandbox-record-1",
        sandboxId: "sbx_123",
      }),
      runHarness: async () => ({
        output: "<<<MOGPLEX_CHECKPOINT>>>\n{}\n<<<END_MOGPLEX_CHECKPOINT>>>",
      }),
      loadAiCall: async () => buildAiCall({ status: "failed" }),
      appendEvent: async () => null,
      notifyRunReachedTerminalState: async () => {},
      notifyRunCheckpoint: async () => {
        checkpointNotified = true;
      },
    }
  );

  assert.equal(result.status, "failed");
  assert.equal(currentRun.status, "failed");
  assert.equal(checkpointNotified, false);
});
