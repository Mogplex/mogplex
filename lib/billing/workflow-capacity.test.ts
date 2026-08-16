import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  admitAutomationJobCapacity,
  rollbackAutomationJobCapacityStart,
} from "./workflow-capacity";

type Call = {
  kind: "from" | "eq" | "rpc";
  name: string;
  value?: unknown;
  args?: Record<string, unknown>;
};

function fakeClient(input?: {
  repo?: { user_id: string; product_team_id: string | null } | null;
  admission?: Record<string, unknown>;
  rollback?: Record<string, unknown>;
}) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      calls.push({ kind: "from", name: table });
      const query = {
        select() {
          return query;
        },
        limit() {
          return query;
        },
        eq(column: string, value: unknown) {
          calls.push({ kind: "eq", name: column, value });
          return query;
        },
        async maybeSingle() {
          if (table === "repos") {
            return { data: input?.repo ?? null, error: null };
          }
          return {
            data: {
              id: "account-1",
              owner_type: input?.repo?.product_team_id ? "team" : "user",
              owner_user_id: input?.repo?.product_team_id ? null : "user-1",
              product_team_id: input?.repo?.product_team_id ?? null,
            },
            error: null,
          };
        },
      };
      return query;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ kind: "rpc", name, args });
      if (name === "rollback_billing_automation_job_start") {
        return {
          data: [input?.rollback ?? { reset: true, lease_released: true }],
          error: null,
        };
      }
      return {
        data: [
          input?.admission ?? {
            posted: true,
            admitted: true,
            would_admit: false,
            active_before: 5,
            concurrency_limit: 5,
            accounting_mode: "shadow",
          },
        ],
        error: null,
      };
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

const CONTEXT = {
  userId: "user-1",
  assignmentId: null,
  triggerId: "trigger-1",
  flowId: null,
  flowVersionId: null,
  repoId: "repo-1",
  installationId: 42,
  sourceKind: "trigger" as const,
  sourceType: "push",
};

describe("automation workflow capacity adapter", () => {
  it("uses the repository team billing scope and preserves shadow decisions", async () => {
    const { client, calls } = fakeClient({
      repo: { user_id: "repo-owner", product_team_id: "team-1" },
    });

    await expect(
      admitAutomationJobCapacity(
        {
          jobRunId: "job-1",
          source: "webhook",
          attemptedAt: "2026-08-16T12:00:00.000Z",
          context: CONTEXT,
        },
        client
      )
    ).resolves.toEqual({
      tracked: true,
      accountId: "account-1",
      posted: true,
      admitted: true,
      wouldAdmit: false,
      activeBefore: 5,
      concurrencyLimit: 5,
      accountingMode: "shadow",
    });

    expect(calls).toContainEqual({
      kind: "eq",
      name: "product_team_id",
      value: "team-1",
    });
    const rpc = calls.find(
      (call) =>
        call.kind === "rpc" && call.name === "admit_billing_workflow_capacity"
    );
    expect(rpc?.args).toMatchObject({
      p_account: "account-1",
      p_root_workflow_ref: "job-1",
      p_metadata: {
        startSource: "webhook",
        sourceKind: "trigger",
        sourceType: "push",
        repoId: "repo-1",
        installationId: 42,
      },
    });
  });

  it("uses the dispatch user when the job has no repository", async () => {
    const { client, calls } = fakeClient();
    const decision = await admitAutomationJobCapacity(
      {
        jobRunId: "job-personal",
        source: "api",
        attemptedAt: "2026-08-16T12:00:00.000Z",
        context: { ...CONTEXT, repoId: null },
      },
      client
    );

    expect(decision.tracked).toBe(true);
    expect(calls.some((call) => call.name === "repos")).toBe(false);
    expect(calls).toContainEqual({
      kind: "eq",
      name: "owner_user_id",
      value: "user-1",
    });
  });

  it("does not block a legacy job whose owner scope cannot be resolved", async () => {
    const { client, calls } = fakeClient();
    await expect(
      admitAutomationJobCapacity(
        {
          jobRunId: "legacy-job",
          source: "repair",
          attemptedAt: "2026-08-16T12:00:00.000Z",
          context: null,
        },
        client
      )
    ).resolves.toMatchObject({ tracked: false, admitted: true });
    expect(calls).toEqual([]);
  });

  it("rejects malformed database admission results", async () => {
    const { client } = fakeClient({
      admission: {
        posted: true,
        admitted: "true",
        would_admit: true,
        active_before: 0,
        concurrency_limit: 5,
        accounting_mode: "shadow",
      },
    });
    await expect(
      admitAutomationJobCapacity(
        {
          jobRunId: "job-bad",
          source: "webhook",
          attemptedAt: "2026-08-16T12:00:00.000Z",
          context: { ...CONTEXT, repoId: null },
        },
        client
      )
    ).rejects.toThrow(/invalid boolean/);
  });

  it("rolls a claimed job and lease back through one RPC", async () => {
    const { client, calls } = fakeClient();
    await expect(
      rollbackAutomationJobCapacityStart(
        {
          jobRunId: "job-1",
          sourceRef: "runtime-start-failed:job-1",
          rolledBackAt: "2026-08-16T12:01:00.000Z",
          metadata: { reason: "runtime_start_failed" },
        },
        client
      )
    ).resolves.toEqual({ reset: true, leaseReleased: true });

    expect(calls.find((call) => call.kind === "rpc")?.args).toEqual({
      p_job_run_id: "job-1",
      p_source_ref: "runtime-start-failed:job-1",
      p_rolled_back_at: "2026-08-16T12:01:00.000Z",
      p_metadata: { reason: "runtime_start_failed" },
    });
  });
});
