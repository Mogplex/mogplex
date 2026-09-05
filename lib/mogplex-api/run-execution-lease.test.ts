import { beforeEach, expect, it } from "vitest";
import type { Sandbox } from "@vercel/sandbox";
import { ensureNativeRunExecutionLease } from "./run-execution-lease";
import {
  renewSandboxActivityLease,
  SANDBOX_AGENT_EXECUTION_LEASE_MS,
} from "@/lib/sandbox/activity-lease";
import { buildRunRow } from "../../tests/unit/helpers/mogplex-api-runs-fixtures";

beforeEach(() => {
  process.env.INTERNAL_API_SECRET = "test-internal-only";
});

function fixture(
  overrides: Record<string, unknown> = {},
  providerStatus = "running"
) {
  const run = buildRunRow();
  const createdAt = new Date();
  let timeout = 600_000;
  const extensions: number[] = [];
  const sandbox = {
    status: providerStatus,
    currentSession: () => ({ createdAt, timeout }),
    extendTimeout: async (value: number) => {
      extensions.push(value);
      timeout += value;
    },
  } as unknown as Sandbox;
  const record = {
    id: "sandbox-record-1",
    user_id: run.user_id,
    repo_id: run.repo_id,
    working_branch: run.working_branch,
    sandbox_id: "sbx_123",
    status: "running",
    product_team_id: null,
    ...overrides,
  };
  return { run, sandbox, record, extensions, timeout: () => timeout };
}

it("resolves authorized record credentials and reserves the execution window", async () => {
  const f = fixture();
  await ensureNativeRunExecutionLease(
    f.run,
    { recordId: f.record.id, sandboxId: "sbx_123" },
    null,
    {
      loadContext: async (request, id, options) => {
        expect(request.headers.get("X-Delegated-User-Id")).toBe(f.run.user_id);
        expect(id).toBe(f.record.id);
        expect(options.requireCapability).toBe("tools.bash");
        expect(options.includeAi).toBe(false);
        return { ok: true, record: f.record, sandbox: f.sandbox };
      },
      renewLease: renewSandboxActivityLease,
    }
  );
  expect(f.extensions).toHaveLength(1);
  expect(f.timeout()).toBeGreaterThanOrEqual(SANDBOX_AGENT_EXECUTION_LEASE_MS);
});

it.each([
  { id: "other-record" },
  { user_id: "other-user" },
  { repo_id: "other-repo" },
  { working_branch: "other-branch" },
  { sandbox_id: "other-provider-vm" },
  { status: "stopped" },
  { product_team_id: "other-team" },
])("never leases a mismatched or stopped record: %s", async (overrides) => {
  const f = fixture(overrides);
  await expect(
    ensureNativeRunExecutionLease(
      f.run,
      { recordId: "sandbox-record-1", sandboxId: "sbx_123" },
      null,
      {
        loadContext: async () => ({
          ok: true,
          record: f.record,
          sandbox: f.sandbox,
        }),
        renewLease: renewSandboxActivityLease,
      }
    )
  ).rejects.toThrow("Active sandbox not found");
  expect(f.extensions).toEqual([]);
});

it("does not auto-resume a stopped provider VM based on a stale running DB row", async () => {
  const f = fixture({}, "stopped");
  await expect(
    ensureNativeRunExecutionLease(
      f.run,
      { recordId: f.record.id, sandboxId: "sbx_123" },
      null,
      {
        loadContext: async () => ({
          ok: true,
          record: f.record,
          sandbox: f.sandbox,
        }),
        renewLease: renewSandboxActivityLease,
      }
    )
  ).rejects.toThrow("Active sandbox not found");
  expect(f.extensions).toEqual([]);
});

it("propagates authorization failures without extending the VM", async () => {
  const f = fixture();
  await expect(
    ensureNativeRunExecutionLease(
      f.run,
      { recordId: f.record.id, sandboxId: "sbx_123" },
      null,
      {
        loadContext: async () => ({
          ok: false,
          status: 403,
          error: "Forbidden",
        }),
        renewLease: renewSandboxActivityLease,
      }
    )
  ).rejects.toThrow("Forbidden");
  expect(f.extensions).toEqual([]);
});

it("uses the team's capability context for a team-owned sandbox", async () => {
  const f = fixture({ product_team_id: "team-1" });
  await ensureNativeRunExecutionLease(
    f.run,
    { recordId: f.record.id, sandboxId: "sbx_123" },
    "team-1",
    {
      loadContext: async (request) => {
        if (request.headers.get("x-mogplex-team-id") !== "team-1")
          return {
            ok: false,
            status: 403,
            error: "Personal capability denied",
          };
        return { ok: true, record: f.record, sandbox: f.sandbox };
      },
      renewLease: renewSandboxActivityLease,
    }
  );
  expect(f.timeout()).toBeGreaterThanOrEqual(SANDBOX_AGENT_EXECUTION_LEASE_MS);
});
