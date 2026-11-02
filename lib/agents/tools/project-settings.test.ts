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
function installRepo(
  overrides: Row = {},
  beforeWrite: (row: Row) => void = () => {}
) {
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
        if (patch) beforeWrite(row);
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
  {
    execute: (input: Record<string, unknown>) => Promise<Row>;
    inputSchema: { safeParse: (input: unknown) => { success: boolean } };
  }
>;

function tools(
  teamId: string | null = null,
  role: "developer" | "viewer" | "lookup-failed" = "developer"
) {
  return createProjectSettingsTools(
    { userId: USER_ID, repoId: REPO_ID, teamId },
    {
      resolveTeam: async () =>
        role === "lookup-failed"
          ? { ok: false, status: 500, error: "Internal server error" }
          : {
              ok: true,
              teamId: teamId ?? "",
              capabilities: presetForRole(role),
            },
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
    expect(result).toMatchObject({ settings: { devPortAuto: false } });
    expect(writes).toEqual([
      expect.objectContaining({
        dev_port_auto: false,
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

  it("should let a team viewer read settings it cannot change", async () => {
    installRepo({
      owner_type: "team",
      owner_user_id: null,
      product_team_id: "team-1",
    });

    expect(
      await tools("team-1", "viewer").project_settings.execute({})
    ).toMatchObject({ envVarNames: ["DATABASE_URL"] });
  });

  it("should not call a failed team lookup a permission problem", async () => {
    installRepo();

    expect(
      await tools("team-1", "lookup-failed").project_settings.execute({})
    ).toEqual({ error: "Could not check your team access. Try again." });
  });

  it("should save the first variable on a project that has none", async () => {
    const { row } = installRepo({ sandbox_env_vars: null });

    expect(
      await tools().project_env_set.execute({ name: "PORT", value: "8000" })
    ).toMatchObject({ ok: true });
    expect(row.sandbox_env_vars).toEqual({ PORT: "8000" });
  });

  it("should not overwrite variables the operator saved after the read", async () => {
    const { row } = installRepo({}, (current) => {
      current.sandbox_env_vars = { OPERATOR_KEY: "saved-meanwhile" };
    });

    expect(
      await tools().project_env_set.execute({ name: "PORT", value: "8000" })
    ).toEqual({ error: "Project variables changed while saving. Try again." });
    expect(row.sandbox_env_vars).toEqual({ OPERATOR_KEY: "saved-meanwhile" });
  });

  it("should reject a dev port outside the valid range", () => {
    const schema = tools().project_settings_update.inputSchema;

    expect(schema.safeParse({ devPort: 0 }).success).toBe(false);
    expect(schema.safeParse({ devPort: 70_000 }).success).toBe(false);
    expect(schema.safeParse({ devPort: 5173 }).success).toBe(true);
  });
});
