import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

let smoke: typeof import("./production-smoke");
let supabaseAdmin: typeof import("@/lib/supabase/admin").supabaseAdmin;
let originalFrom: typeof supabaseAdmin.from;

beforeAll(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  ({ supabaseAdmin } = await import("@/lib/supabase/admin"));
  originalFrom = supabaseAdmin.from.bind(supabaseAdmin);
  smoke = await import("./production-smoke");
});

beforeEach(() => {
  Object.defineProperty(supabaseAdmin, "from", {
    configurable: true,
    writable: true,
    value: originalFrom,
  });
});

afterAll(() => {
  Object.defineProperty(supabaseAdmin, "from", {
    configurable: true,
    writable: true,
    value: originalFrom,
  });
});

describe("production Control session smoke", () => {
  it("runs every database probe through the supplied admin client", async () => {
    const tables: string[] = [];
    const buildQuery = (table: string) => {
      const result = {
        data:
          table === "automation_dispatch_events"
            ? [
                {
                  job_run_id: "job-1",
                  source_type: "pr_review",
                  reason: "failed",
                  metadata: null,
                  created_at: "2026-08-15T13:00:00.000Z",
                },
              ]
            : table === "job_runs"
              ? [
                  {
                    id: "job-1",
                    status: "failed",
                    cost_usd: null,
                    error: "Review failed",
                    metadata: null,
                  },
                ]
              : [],
        error: null,
        count: 0,
      };
      const resultPromise = Promise.resolve(result);
      const query = {
        select: () => query,
        eq: () => query,
        in: () => query,
        not: () => query,
        order: () => query,
        limit: () => resultPromise,
        then: resultPromise.then.bind(resultPromise),
      };
      return query;
    };
    const adminClient = {
      from: (table: string) => {
        tables.push(table);
        return buildQuery(table);
      },
    } as unknown as SupabaseClient;
    Object.defineProperty(supabaseAdmin, "from", {
      configurable: true,
      writable: true,
      value: () => {
        throw new Error("global admin client used");
      },
    });

    const summary = await smoke.runProductionSmokeChecks({}, adminClient);

    expect(summary.ok).toBe(true);
    expect(tables).toEqual([
      "repos",
      "repos",
      "workspaces",
      "control_sessions",
      "github_installations",
      "repos",
      "automation_dispatch_events",
      "job_runs",
    ]);
  });

  it("queries the table and columns used by Control session/worktree APIs", async () => {
    const tables: string[] = [];
    const query = {
      select: () => query,
      limit: async () => ({ error: null }),
    };
    Object.defineProperty(supabaseAdmin, "from", {
      configurable: true,
      writable: true,
      value: (table: string) => {
        tables.push(table);
        return query;
      },
    });

    await expect(smoke.checkControlSessionsSelect()).resolves.toBe(
      "Queried Control sessions with repository and orchestration context"
    );
    expect(tables).toEqual(["control_sessions"]);
  });

  it("fails the smoke when the production schema query fails", async () => {
    const query = {
      select: () => query,
      limit: async () => ({ error: { message: "missing table" } }),
    };
    Object.defineProperty(supabaseAdmin, "from", {
      configurable: true,
      writable: true,
      value: () => query,
    });

    await expect(smoke.checkControlSessionsSelect()).rejects.toThrow(
      "missing table"
    );
  });

  it("includes the Control session probe in the aggregate smoke", async () => {
    const summary = await smoke.runProductionSmokeChecks({
      checkReposSelect: async () => "ok",
      checkRepoWorkspaceIdsSelect: async () => "ok",
      checkWorkspacesSelect: async () => "ok",
      checkControlSessionsSelect: async () => "control sessions ok",
      checkGithubInstallationsCount: async () => "ok",
      checkRepoBaselineSnapshotMetadata: async () => "ok",
      checkReviewRunObservabilityProjection: async () => "ok",
    });

    expect(summary.checks).toContainEqual({
      name: "control_sessions_select",
      ok: true,
      detail: "control sessions ok",
    });
  });
});
