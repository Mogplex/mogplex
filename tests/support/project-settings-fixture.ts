/**
 * Fake repos row behind the database boundary for the Control project
 * settings tool tests. Importing it installs the hooks that restore
 * supabaseAdmin.from after each test.
 */
import { afterEach, beforeAll } from "vitest";
import { presetForRole } from "@/lib/team-capabilities";
import { createProjectSettingsTools } from "@/lib/agents/tools/project-settings";

export const REPO_ID = "00000000-0000-4000-8000-000000000001";
export const USER_ID = "user-1";

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
export function installRepo(
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
  const reads = { count: 0 };
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
        else reads.count += 1;
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
  return { row, writes, reads };
}

type ToolRecord = Record<
  string,
  {
    execute: (input: Record<string, unknown>) => Promise<Row>;
    inputSchema: { safeParse: (input: unknown) => { success: boolean } };
  }
>;

export function tools(
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
