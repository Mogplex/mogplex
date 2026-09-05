import { expect, it } from "vitest";
import { deliverSlackRunUpdate } from "./run-delivery";
import { stripSlackRunControlsForTerminalRun } from "./run-controls-notify";
import { buildRunRow } from "../../tests/unit/helpers/mogplex-api-runs-fixtures";
import { serializeRunProgress } from "./run-progress-store";
import { applyRunProgress, createRunProgressState } from "./run-progress-state";
import type { UpdateSlackMessageInput } from "./client";

process.env.NEXT_PUBLIC_APP_URL ||= "https://mogplex.com";

function fixture() {
  const state = createRunProgressState(1000);
  applyRunProgress(
    state,
    {
      kind: "phase",
      phase: "Verifying",
      summary: "Updated the mobile controls.",
      next: "Check desktop layout.",
    },
    2000
  );
  let run = buildRunRow({
    status: "streaming",
    metadata: {
      slack_task_title: "Fix mobile controls",
      slackRunControls: { teamId: "T1", channelId: "C1", messageTs: "1.2" },
    },
    slack_progress: serializeRunProgress(state),
    slack_progress_revision: 3,
  });
  const updates: UpdateSlackMessageInput[] = [];
  let clock = 10_000;
  const updateMessage = async (
    _token: string,
    message: UpdateSlackMessageInput
  ) => {
    updates.push(message);
    return { channel: "C1", ts: "1.2" };
  };
  const deps = {
    loadRun: async (userId: string, runId: string) =>
      userId === run.user_id && runId === run.id ? run : null,
    getToken: async () => "test-token",
    updateMessage,
    sendTerminal: (
      row: Parameters<typeof stripSlackRunControlsForTerminalRun>[0],
      status: typeof run.status
    ) =>
      stripSlackRunControlsForTerminalRun(row, status, {
        getSlackBotToken: async () => "test-token",
        updateSlackMessage: updateMessage,
        loadRunOutput: async () =>
          "Changed the controls. Tests passed. https://github.com/example/app/pull/42",
      }),
    markDelivered: async (
      _row: typeof run,
      _status: typeof run.status,
      key: string
    ) => {
      run = { ...run, slack_terminal_notification_key: key };
    },
    markProgressDelivered: async (_row: typeof run, key: string) => {
      run = {
        ...run,
        slack_progress_delivered_key: key,
        slack_progress_delivered_at: new Date(clock).toISOString(),
      };
    },
    now: () => clock,
    wait: async (milliseconds: number) => {
      clock += milliseconds;
    },
  };
  return {
    updates,
    deps,
    input: { runId: run.id, userId: run.user_id },
    getRun: () => run,
    setRun: (update: Partial<typeof run>) => {
      run = { ...run, ...update };
    },
  };
}

it("coalesces queued progress jobs against the latest durable snapshot", async () => {
  const f = fixture();
  await deliverSlackRunUpdate(f.input, f.deps);
  await deliverSlackRunUpdate(f.input, f.deps);
  expect(f.updates).toHaveLength(1);
  expect(f.updates[0].text).toContain("Updated the mobile controls.");
  expect(f.getRun().slack_progress_delivered_key).toBeTruthy();
});

it("a late progress job renders the actual terminal result and cannot resurrect Cancel", async () => {
  const f = fixture();
  f.setRun({ status: "success" });
  await deliverSlackRunUpdate(f.input, f.deps);
  await deliverSlackRunUpdate(f.input, f.deps);
  expect(f.updates).toHaveLength(1);
  expect(f.updates[0].text).toContain("https://github.com/example/app/pull/42");
  expect(f.updates[0].text).not.toContain("Preparing the next step");
  expect(JSON.stringify(f.updates[0].blocks)).not.toContain(
    "mogplex-cancel-run"
  );
});

it("reloads after delivery pacing so completion during the wait wins", async () => {
  const f = fixture();
  f.setRun({ slack_progress_delivered_at: new Date(9500).toISOString() });
  await deliverSlackRunUpdate(f.input, {
    ...f.deps,
    wait: async () => {
      f.setRun({ status: "cancelled" });
    },
  });
  expect(f.updates[0].text).toContain("cancelled");
  expect(f.updates[0].blocks?.some((block) => block.type === "plan")).toBe(
    false
  );
});

it("does not mark a missing token or failed Slack call as delivered", async () => {
  const f = fixture();
  await expect(
    deliverSlackRunUpdate(f.input, { ...f.deps, getToken: async () => null })
  ).rejects.toThrow();
  await expect(
    deliverSlackRunUpdate(f.input, {
      ...f.deps,
      updateMessage: async () => {
        throw new Error("Slack unavailable");
      },
    })
  ).rejects.toThrow();
  expect(f.getRun().slack_progress_delivered_key).toBeUndefined();
});

it("does not cross the run owner boundary", async () => {
  const f = fixture();
  expect(
    await deliverSlackRunUpdate({ ...f.input, userId: "other-owner" }, f.deps)
  ).toEqual({ delivered: false });
  expect(f.updates).toHaveLength(0);
});

it("shows a real review pause without an active work timeline", async () => {
  const f = fixture();
  f.setRun({ status: "awaiting_input" });
  await deliverSlackRunUpdate(f.input, f.deps);
  expect(f.updates[0].text).toContain("Waiting for your review");
  expect(f.updates[0].blocks?.some((block) => block.type === "plan")).toBe(
    false
  );
});

it("preserves worker preparation rather than labelling it queued", async () => {
  const f = fixture();
  const state = createRunProgressState(1000);
  applyRunProgress(
    state,
    {
      kind: "phase",
      phase: "Preparing workspace",
      summary: "Starting the isolated workspace.",
      next: "Inspect the repository.",
    },
    2000
  );
  f.setRun({ status: "pending", slack_progress: serializeRunProgress(state) });
  await deliverSlackRunUpdate(f.input, f.deps);
  expect(f.updates[0].text).toContain("Starting the isolated workspace.");
  expect(f.updates[0].text).not.toContain("Waiting for the coding worker");
});
