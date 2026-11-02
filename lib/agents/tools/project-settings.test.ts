import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { presetForRole } from "@/lib/team-capabilities";
import { createProjectSettingsTools } from "./project-settings";

const REPO_ID = "00000000-0000-4000-8000-000000000001";
const USER_ID = "user-1";

type Row = Record<string, unknown>;
type Filter = { op: "eq" | "is"; column: string; value: unknown };

let supabaseAdmin: typeof import("@/lib/supabase/admin").supabaseAdmin;
let originalFrom: typeof supabaseAdmin.from;

beforeAll(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
  ({ supabaseAdmin } = await import("@/lib/supabase/admin"));
  originalFrom = supabaseAdmin.from.bind(supabaseAdmin);
});

afterEach(() => {
  Object.defineProperty(supabaseAdmin, "from", {
    configurable: true,
    writable: true,
    value: originalFrom,
  });
});

const matches = (row: Row, filters: Filter[]) =>
  filters.every(({ op, column, value }) => {
    const actual = row[column] ?? null;
    if (op === "is") return actual === value;
    return column === "sandbox_env_vars"
      ? JSON.stringify(actual) === value
      : actual === value;
  });

/** One repos row behind the database boundary; records every write. */
function installRepo(overrides: Row = {}) {
  const row: Row = {
    id: REPO_ID,
    owner_type: "user",
    owner_user_id: USER_ID,
    product_team_id: null,
    runtime: "node22",
    root_directory: null,
    install_command: null,
    dev_command: null,
    dev_port: 3000,
    env_sync_mode: "sandbox-only",
    sandbox_env_vars: { DATABASE_URL: "postgres://owner@db/app" },
    ...overrides,
  };
  const writes: Row[] = [];
  const query = () => {
    const filters: Filter[] = [];
    let patch: Row | null = null;
    const builder = {
      select: () => builder,
      update: (next: Row) => {
        patch = next;
        return builder;
      },
      eq: (column: string, value: unknown) => {
        filters.push({ op: "eq", column, value });
        return builder;
      },
      is: (column: string, value: unknown) => {
        filters.push({ op: "is", column, value });
        return builder;
      },
      maybeSingle: async () => {
        if (!matches(row, filters)) return { data: null, error: null };
        if (patch) {
          writes.push(patch);
          Object.assign(row, patch);
        }
        return { data: { ...row }, error: null };
      },
    };
    return builder;
  };
  Object.defineProperty(supabaseAdmin, "from", {
    configurable: true,
    writable: true,
    value: query,
  });
  return { row, writes };
}

type ToolRecord = Record<
  string,
  { execute: (input: Record<string, unknown>) => Promise<Row> }
>;

function tools(
  teamId: string | null = null,
  role: "developer" | "viewer" = "developer"
) {
  return createProjectSettingsTools(
    { userId: USER_ID, repoId: REPO_ID, teamId },
    {
      resolveTeam: async () => ({
        ok: true,
        teamId: teamId ?? "",
        capabilities: presetForRole(role),
      }),
    }
  ) as unknown as ToolRecord;
}

describe("project settings tools", () => {
  it("should report variable names without their values", async () => {
    installRepo();

    const settings = await tools().project_settings.execute({});

    expect(settings).toMatchObject({
      runtime: "node22",
      devPort: 3000,
      envVarNames: ["DATABASE_URL"],
    });
    expect(JSON.stringify(settings)).not.toContain("postgres://");
  });

  it("should save working commands for future boots", async () => {
    const { writes } = installRepo();

    const result = await tools().project_settings_update.execute({
      installCommand: "pip install -e .",
      devCommand: "uvicorn app.main:app --host 0.0.0.0 --port 8000",
      devPort: 8000,
      rootDirectory: "api",
    });

    expect(result).toMatchObject({
      ok: true,
      settings: { devPort: 8000, rootDirectory: "api" },
    });
    expect(writes).toEqual([
      expect.objectContaining({
        install_command: "pip install -e .",
        dev_command: "uvicorn app.main:app --host 0.0.0.0 --port 8000",
        dev_port: 8000,
        root_directory: "api",
      }),
    ]);
  });

  it("should add a variable without dropping the ones already saved", async () => {
    const { row } = installRepo();

    const result = await tools().project_env_set.execute({
      name: "NODE_ENV",
      value: "development",
    });

    expect(result).toMatchObject({ ok: true, name: "NODE_ENV" });
    expect(row.sandbox_env_vars).toEqual({
      DATABASE_URL: "postgres://owner@db/app",
      NODE_ENV: "development",
    });
  });

  it("should reject names a shell or the stored object cannot hold", async () => {
    const { writes } = installRepo();

    for (const name of ["1PORT", "MY-VAR", "__proto__", " "]) {
      expect(
        await tools().project_env_set.execute({ name, value: "x" })
      ).toHaveProperty("error");
    }
    expect(writes).toEqual([]);
  });

  it("should refuse a team project to a member without project write access", async () => {
    const { writes } = installRepo({
      owner_type: "team",
      owner_user_id: null,
      product_team_id: "team-1",
    });

    const result = await tools(
      "team-1",
      "viewer"
    ).project_settings_update.execute({ devPort: 8000 });

    expect(result).toEqual({
      error: "You do not have permission to change this project.",
    });
    expect(writes).toEqual([]);
  });

  it("should save a team project for a member with project write access", async () => {
    installRepo({
      owner_type: "team",
      owner_user_id: null,
      product_team_id: "team-1",
    });

    expect(
      await tools("team-1").project_settings_update.execute({ devPort: 8000 })
    ).toMatchObject({ ok: true });
  });

  it("should not reach another user's personal project", async () => {
    installRepo({ owner_user_id: "someone-else" });

    expect(await tools().project_settings.execute({})).toEqual({
      error: "Project not found.",
    });
  });
});
