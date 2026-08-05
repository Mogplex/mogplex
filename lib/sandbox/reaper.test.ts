import { describe, expect, it, vi } from "vitest";
import { sandboxRecord } from "@/lib/sandbox/test-fixtures";

async function loadReaper() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("@/lib/sandbox/reaper");
}

describe("stopReasonForAction", () => {
  it.each([
    ["stopped_idle", "idle_timeout"],
    ["stopped_max_lifetime", "lifetime_timeout"],
    ["stopped_stuck_boot", "stuck_boot"],
    ["stopped_vm_gone", "vm_gone"],
  ] as const)("maps %s to %s", async (action, reason) => {
    const { stopReasonForAction } = await loadReaper();

    expect(stopReasonForAction(action)).toBe(reason);
  });
});

describe("stopSandbox", () => {
  it.each([
    ["stopped_idle", "idle_timeout"],
    ["stopped_vm_gone", "vm_gone"],
    ["stopped_stuck_boot", "stuck_boot"],
  ] as const)(
    "passes %s stop_reason to the stopped-record writer",
    async (onSuccessAction, stopReason) => {
      const { stopSandbox } = await loadReaper();
      const record = sandboxRecord({ status: "running" });
      const stopSandboxRecord = vi.fn(async () => null);

      const result = await stopSandbox(
        {
          id: record.id,
          sandbox_id: record.sandbox_id,
          status: record.runtime_summary.status,
          persistent: false,
        },
        {
          ok: true,
          vercelToken: "token",
          vercelTeamId: null,
          vercelProjectId: "project",
        },
        { onSuccessAction },
        {
          getSandbox: async () =>
            ({
              stop: async () => {},
              currentSession: () => ({
                updatedAt: new Date("2026-04-01T10:05:00.000Z"),
              }),
              currentSnapshotId: null,
            }) as never,
          stopSandboxRecord,
          updateSandboxRecord: async () => {
            throw new Error("updateSandboxRecord should not be called");
          },
          prepareSandboxBillingClose: async () => null,
          finalizeSandboxBillingClose: async () => ({
            finalized: false,
            metered: false,
          }),
        }
      );

      expect(result).toEqual({ stopped: true, action: onSuccessAction });
      expect(stopSandboxRecord).toHaveBeenCalledWith(record.id, {
        expectedSandboxId: record.sandbox_id,
        expectedHealthStatus: undefined,
        fromStatuses: ["creating", "installing", "running"],
        stopReason,
      });
    }
  );

  it.each([
    ["stopped_idle", "paused_idle"],
    ["stopped_max_lifetime", "paused_max_lifetime"],
  ] as const)(
    "soft-pauses persistent sandboxes on %s → %s",
    async (onSuccessAction, expectedAction) => {
      const { stopSandbox } = await loadReaper();
      const record = sandboxRecord({ status: "running" });
      const stopSandboxRecord = vi.fn(async () => {
        throw new Error("stopSandboxRecord should not be called on soft-pause");
      });
      const updateSandboxRecord = vi.fn(async () => null);

      const result = await stopSandbox(
        {
          id: record.id,
          sandbox_id: record.sandbox_id,
          status: record.runtime_summary.status,
          persistent: true,
        },
        {
          ok: true,
          vercelToken: "token",
          vercelTeamId: null,
          vercelProjectId: "project",
        },
        { onSuccessAction },
        {
          getSandbox: async () =>
            ({
              stop: async () => {},
              currentSession: () => ({
                updatedAt: new Date("2026-04-01T10:05:00.000Z"),
              }),
              currentSnapshotId: "snap-1",
            }) as never,
          stopSandboxRecord,
          updateSandboxRecord,
          prepareSandboxBillingClose: async () => null,
          finalizeSandboxBillingClose: async () => ({
            finalized: false,
            metered: false,
          }),
        }
      );

      expect(result).toEqual({ stopped: true, action: expectedAction });
      expect(stopSandboxRecord).not.toHaveBeenCalled();
      expect(updateSandboxRecord).toHaveBeenCalledWith(
        record.id,
        {
          status: "paused",
          health_status: "paused",
          snapshot_id: "snap-1",
        },
        {
          expectedSandboxId: record.sandbox_id,
          expectedHealthStatus: undefined,
          fromStatuses: ["creating", "installing", "running"],
        }
      );
    }
  );

  it("soft-pauses without snapshot_id when the VM has no current snapshot", async () => {
    const { stopSandbox } = await loadReaper();
    const record = sandboxRecord({ status: "running" });
    const stopSandboxRecord = vi.fn(async () => {
      throw new Error("stopSandboxRecord should not be called on soft-pause");
    });
    const updateSandboxRecord = vi.fn(async () => null);

    const result = await stopSandbox(
      {
        id: record.id,
        sandbox_id: record.sandbox_id,
        status: record.runtime_summary.status,
        persistent: true,
      },
      {
        ok: true,
        vercelToken: "token",
        vercelTeamId: null,
        vercelProjectId: "project",
      },
      { onSuccessAction: "stopped_idle" },
      {
        getSandbox: async () =>
          ({
            stop: async () => {},
            currentSession: () => ({
              updatedAt: new Date("2026-04-01T10:05:00.000Z"),
            }),
            currentSnapshotId: null,
          }) as never,
        stopSandboxRecord,
        updateSandboxRecord,
        prepareSandboxBillingClose: async () => null,
        finalizeSandboxBillingClose: async () => ({
          finalized: false,
          metered: false,
        }),
      }
    );

    expect(result).toEqual({ stopped: true, action: "paused_idle" });
    expect(updateSandboxRecord).toHaveBeenCalledWith(
      record.id,
      {
        status: "paused",
        health_status: "paused",
      },
      {
        expectedSandboxId: record.sandbox_id,
        expectedHealthStatus: undefined,
        fromStatuses: ["creating", "installing", "running"],
      }
    );
    const call = updateSandboxRecord.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
      unknown,
    ];
    expect(call[1]).not.toHaveProperty("snapshot_id");
  });
});
