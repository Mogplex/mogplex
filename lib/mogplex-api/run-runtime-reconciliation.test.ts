import { afterEach, expect, it, vi } from "vitest";
import {
  finalizeRunAfterWorkerExit,
  type RuntimeFinalizationDeps,
} from "./run-runtime-reconciliation";
import {
  buildAiCall,
  buildRunRow,
} from "../../tests/unit/helpers/mogplex-api-runs-fixtures";
import { stripSlackRunControlsForTerminalRun } from "@/lib/slack/run-controls-notify";

afterEach(() => vi.unstubAllEnvs());

function fixture() {
  let run = buildRunRow({
    status: "streaming",
    runtime_provider: "trigger",
    runtime_run_id: "run_worker",
  });
  let call = buildAiCall({
    status: "streaming",
    input_tokens: 123,
    runtime_command_id: "cmd_retained",
  });
  const notified: string[] = [];
  const events: string[] = [];
  const deps: RuntimeFinalizationDeps = {
    loadRun: async () => run,
    loadCall: async () => call,
    finishCall: async (expected, status, error) => {
      if (
        call.status !== "streaming" ||
        call.control_state !== expected.control_state
      )
        return null;
      call = { ...call, status, error };
      return call;
    },
    syncRun: async (expected, status, error) => {
      if (
        run.status !== "streaming" ||
        run.ai_call_id !== expected.ai_call_id ||
        run.runtime_run_id !== expected.runtime_run_id
      )
        return null;
      run = { ...run, status, error };
      return run;
    },
    appendEvent: async (event) => {
      events.push(event.eventType);
      return null;
    },
    notifyTerminal: async (_run, status) => {
      notified.push(status);
    },
  };
  return {
    deps,
    run: () => run,
    call: () => call,
    notified,
    events,
    setRun: (patch: Partial<typeof run>) => {
      run = { ...run, ...patch };
    },
    setCall: (patch: Partial<typeof call>) => {
      call = { ...call, ...patch };
    },
  };
}
const timeout = {
  status: "failed",
  error: "Agent worker timed out before completion.",
} as const;

it("finalizes both records and replaces stale Slack controls after a hard timeout", async () => {
  const f = fixture();
  const result = await finalizeRunAfterWorkerExit(f.run(), timeout, f.deps);
  expect(result?.status).toBe("failed");
  expect(f.call()).toMatchObject({
    status: "failed",
    error: timeout.error,
    input_tokens: 123,
    runtime_command_id: "cmd_retained",
  });
  expect(f.notified).toEqual(["failed"]);
  expect(f.events).toEqual(["failed"]);
});

it("preserves completed work when a worker dies after persisting its result", async () => {
  const f = fixture();
  f.setCall({ status: "success" });
  expect(
    (await finalizeRunAfterWorkerExit(f.run(), timeout, f.deps))?.status
  ).toBe("success");
  expect(f.call().status).toBe("success");
  expect(f.notified).toEqual(["success"]);
});

it.each(["success", "failed", "cancelled", "awaiting_input"] as const)(
  "never overwrites an already %s run",
  async (status) => {
    const f = fixture();
    f.setRun({ status });
    f.setCall({ status: status === "awaiting_input" ? "success" : status });
    const result = await finalizeRunAfterWorkerExit(f.run(), timeout, f.deps);
    expect(result?.status).toBe(status);
    expect(f.notified).toEqual(status === "awaiting_input" ? [] : [status]);
  }
);

it("finishes an existing failed run's orphaned call, too", async () => {
  const f = fixture();
  f.setRun({ status: "failed", error: "Failure already recorded" });
  await finalizeRunAfterWorkerExit(f.run(), timeout, f.deps);
  expect(f.call()).toMatchObject({
    status: "failed",
    error: "Failure already recorded",
  });
});

it("honors cancellation requested before worker termination", async () => {
  const f = fixture();
  f.setCall({ control_state: "cancel_requested" });
  await finalizeRunAfterWorkerExit(f.run(), timeout, f.deps);
  expect(f.run().status).toBe("cancelled");
  expect(f.call().status).toBe("cancelled");
});

it.each([{ runtime_run_id: "run_new" }, { ai_call_id: "new_segment" }])(
  "ignores a late result after execution identity changed: %s",
  async (patch) => {
    const f = fixture();
    const expected = f.run();
    f.setRun(patch);
    await finalizeRunAfterWorkerExit(expected, timeout, f.deps);
    expect(f.run().status).toBe("streaming");
    expect(f.call().status).toBe("streaming");
    expect(f.notified).toEqual([]);
  }
);

it("does not overwrite a cancellation that races call finalization", async () => {
  const f = fixture();
  f.deps.finishCall = async () => {
    f.setCall({ status: "cancelled", control_state: "cancelled" });
    return null;
  };
  await finalizeRunAfterWorkerExit(f.run(), timeout, f.deps);
  expect(f.run().status).toBe("cancelled");
  expect(f.notified).toEqual(["cancelled"]);
});

it("retries failed notification without changing terminal history or duplicating events", async () => {
  const f = fixture();
  const expected = f.run();
  const failure = new Error("Slack unavailable");
  const notify = f.deps.notifyTerminal;
  f.deps.notifyTerminal = async () => {
    throw failure;
  };
  await expect(
    finalizeRunAfterWorkerExit(expected, timeout, f.deps)
  ).rejects.toBe(failure);
  f.deps.notifyTerminal = notify;
  await finalizeRunAfterWorkerExit(expected, timeout, f.deps);
  expect(f.run().status).toBe("failed");
  expect(f.notified).toEqual(["failed"]);
  expect(f.events).toEqual(["failed"]);
});

it("replaces the Slack message with a failed result and no Cancel action", async () => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://example.test");
  const f = fixture();
  f.setRun({
    metadata: {
      slackRunControls: {
        teamId: "T_TEST",
        channelId: "D_TEST",
        messageTs: "123.456",
      },
    },
  });
  let slackMessage:
    | Parameters<
        NonNullable<
          Parameters<typeof stripSlackRunControlsForTerminalRun>[2]
        >["updateSlackMessage"]
      >[1]
    | undefined;
  f.deps.notifyTerminal = async (run, status) => {
    await stripSlackRunControlsForTerminalRun(run, status, {
      getSlackBotToken: async () => "test-slack-token",
      updateSlackMessage: async (_token, input) => {
        slackMessage = input;
      },
    });
  };
  await finalizeRunAfterWorkerExit(f.run(), timeout, f.deps);
  expect(slackMessage).toMatchObject({ channel: "D_TEST", ts: "123.456" });
  expect(slackMessage?.text).toMatch(/failed/i);
  expect(JSON.stringify(slackMessage?.blocks)).not.toContain("Cancel run");
  expect(JSON.stringify(slackMessage?.blocks)).toContain("View run details");
});

it("fails closed when the call is missing or remains active after a competing update", async () => {
  const f = fixture();
  f.deps.loadCall = async () => null;
  await expect(
    finalizeRunAfterWorkerExit(f.run(), timeout, f.deps)
  ).rejects.toThrow("Worker call not found");
  f.deps.loadCall = async () => f.call();
  f.deps.finishCall = async () => null;
  await expect(
    finalizeRunAfterWorkerExit(f.run(), timeout, f.deps)
  ).rejects.toThrow("changed during finalization");
  expect(f.run().status).toBe("streaming");
  expect(f.notified).toEqual([]);
});

it("returns a newer row if run synchronization loses a race", async () => {
  const f = fixture();
  f.deps.syncRun = async () => {
    f.setRun({ status: "awaiting_input" });
    return null;
  };
  expect(
    (await finalizeRunAfterWorkerExit(f.run(), timeout, f.deps))?.status
  ).toBe("awaiting_input");
  expect(f.notified).toEqual([]);
});

it("does not fabricate success when the worker completes without a saved call result", async () => {
  const f = fixture();
  await finalizeRunAfterWorkerExit(
    f.run(),
    { status: "completed", error: null },
    f.deps
  );
  expect(f.run()).toMatchObject({
    status: "failed",
    error: "Agent worker ended without a terminal result.",
  });
});

it("returns null if the run was deleted", async () => {
  const f = fixture();
  f.deps.loadRun = async () => null;
  expect(await finalizeRunAfterWorkerExit(f.run(), timeout, f.deps)).toBeNull();
  expect(f.notified).toEqual([]);
});
