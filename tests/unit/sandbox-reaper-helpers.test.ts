import assert from "node:assert/strict";
import test from "node:test";
import { buildReaperStaleStoppedSandbox } from "./sandbox-reaper-test-harness";

async function loadSandboxReaperHelpers() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../lib/sandbox/reaper-helpers");
}

function buildRepairTarget(
  overrides: Parameters<typeof buildReaperStaleStoppedSandbox>[0] = {}
) {
  return buildReaperStaleStoppedSandbox({
    id: "sandbox-1",
    sandbox_id: "vm_123",
    ...overrides,
  });
}

test("repairStoppedSandboxHealthStatus uses race-safe stopped-row guards", async () => {
  const { repairStoppedSandboxHealthStatus } = await loadSandboxReaperHelpers();
  const calls: Array<{
    id: string;
    options: Record<string, unknown> | undefined;
  }> = [];

  const result = await repairStoppedSandboxHealthStatus(buildRepairTarget(), {
    stopSandboxRecord: async (id, options) => {
      calls.push({ id, options });
      return { id } as never;
    },
  });

  assert.deepEqual(result, {
    repaired: true,
    action: "repaired_stopped_health_status",
  });

  assert.deepEqual(calls, [
    {
      id: "sandbox-1",
      options: {
        expectedSandboxId: "vm_123",
        expectedHealthStatus: "app_error",
        fromStatuses: "stopped",
        healthStatus: "stopped",
      },
    },
  ]);
});

test("repairStoppedSandboxHealthStatus repairs null health state without an exact health guard", async () => {
  const { repairStoppedSandboxHealthStatus } = await loadSandboxReaperHelpers();
  const calls: Array<{
    id: string;
    options: Record<string, unknown> | undefined;
  }> = [];

  const result = await repairStoppedSandboxHealthStatus(
    buildRepairTarget({
      id: "sandbox-2",
      sandbox_id: "vm_456",
      health_status: null,
    }),
    {
      stopSandboxRecord: async (id, options) => {
        calls.push({ id, options });
        return { id } as never;
      },
    }
  );

  assert.deepEqual(result, {
    repaired: true,
    action: "repaired_stopped_health_status",
  });

  assert.deepEqual(calls, [
    {
      id: "sandbox-2",
      options: {
        expectedSandboxId: "vm_456",
        expectedHealthStatus: undefined,
        fromStatuses: "stopped",
        healthStatus: "stopped",
      },
    },
  ]);
});

test("repairStoppedSandboxHealthStatus reports when the guarded write no-ops", async () => {
  const { repairStoppedSandboxHealthStatus } = await loadSandboxReaperHelpers();

  const result = await repairStoppedSandboxHealthStatus(
    buildRepairTarget({
      id: "sandbox-3",
      sandbox_id: "vm_789",
      health_status: "unreachable",
    }),
    {
      stopSandboxRecord: async () => null,
    }
  );

  assert.deepEqual(result, {
    repaired: false,
    action: "stopped_health_status_already_converged",
  });
});
