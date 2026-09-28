import { expect, it } from "vitest";
import { cleanupTerminalRunSandbox } from "./run-sandbox-cleanup";
import { stopSandbox } from "@/lib/sandbox/reaper-stop";
import { buildRunRow } from "../../tests/unit/helpers/mogplex-api-runs-fixtures";

function fixture(failStop = false) {
  const run = buildRunRow({ create_branch: true, status: "failed" });
  let record = {
    id: run.sandbox_record_id!,
    user_id: run.user_id,
    repo_id: run.repo_id,
    sandbox_id: run.sandbox_id!,
    status: "running",
    health_status: "running",
    exec_lock_token: null,
    persistent: true,
    last_active_at: "2026-09-28T12:00:00Z",
  };
  const writes: Record<string, unknown>[] = [];
  let stopped = false;
  let claimed = false;
  let billingClosed = false;
  const update: typeof import("@/lib/sandbox/records").updateSandboxRecord =
    async (_id, values) => {
      writes.push(values);
      record = { ...record, ...values };
      return record as never;
    };
  return {
    run,
    writes,
    state: () => ({ record, stopped, claimed, billingClosed }),
    deps: {
      loadSandbox: async () => record,
      resolveCredentials: async () => ({
        vercelToken: "fixture",
        vercelTeamId: null,
        vercelProjectId: "project",
      }),
      claim: async () => {
        claimed = true;
        const before = { ...record };
        record = { ...record, status: "pausing" };
        return before;
      },
      updateSandbox: update,
      stop: ((sandbox, credentials, options) =>
        stopSandbox(sandbox, credentials, options, {
          getSandbox: async () =>
            ({
              stop: async (input: { blocking: boolean }) => {
                expect(input.blocking).toBe(true);
                if (failStop) throw new Error("provider unavailable");
                stopped = true;
              },
              currentSession: () => ({
                stoppedAt: new Date("2026-09-28T12:01:00Z"),
              }),
              currentSnapshotId: "saved-work",
            }) as never,
          updateSandboxRecord: update,
          stopSandboxRecord: async () => {
            throw new Error("must preserve workspace");
          },
          prepareSandboxBillingClose: async () => null,
          finalizeSandboxBillingClose: async () => {
            billingClosed = true;
            return { finalized: true, metered: true };
          },
        })) satisfies typeof stopSandbox,
    },
  };
}

it("stops provider compute, saves the snapshot and closes billing", async () => {
  const f = fixture();
  await cleanupTerminalRunSandbox(f.run, f.deps);
  expect(f.state()).toMatchObject({
    stopped: true,
    billingClosed: true,
    record: { status: "paused", snapshot_id: "saved-work" },
  });
});

it("restores a failed pause for a durable supervisor retry", async () => {
  const f = fixture(true);
  await expect(cleanupTerminalRunSandbox(f.run, f.deps)).rejects.toThrow(
    "Could not pause"
  );
  expect(f.state()).toMatchObject({
    stopped: false,
    record: {
      status: "running",
      last_active_at: "2026-09-28T12:00:00Z",
    },
  });
});

it.each([
  { create_branch: false },
  { worktree_id: "shared" },
  { status: "awaiting_input" as const },
  { user_id: "other" },
])("does not claim unrelated or nonterminal work: %s", async (patch) => {
  const f = fixture();
  await cleanupTerminalRunSandbox({ ...f.run, ...patch }, f.deps);
  expect(f.state().claimed).toBe(false);
});

it("does not stop a sandbox whose atomic claim was refused", async () => {
  const f = fixture();
  await cleanupTerminalRunSandbox(f.run, {
    ...f.deps,
    claim: async () => null,
  });
  expect(f.state().stopped).toBe(false);
});
