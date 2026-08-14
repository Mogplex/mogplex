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
