import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { vector } from "@electric-sql/pglite/vector";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createProjectSettingsTools } from "@/lib/agents/tools/project-settings";
import { applyNeonMigrations } from "@/lib/db/neon-migrations";
import { SHIM_TYPE_PARSERS } from "@/lib/db/pool";
import { createPostgrestShim } from "@/lib/db/postgrest-shim";
import { supabaseAdmin } from "@/lib/supabase/admin";

const owner = "00000000-0000-4000-8000-000000000021";
const repoId = "00000000-0000-4000-8000-000000000022";
let db: PGlite;
/** Runs once, right before the next UPDATE of repos reaches the database. */
let beforeRepoUpdate: (() => Promise<unknown>) | null = null;
const previous = new Map<string, PropertyDescriptor | undefined>();

type EnvSet = {
  execute: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

const envSet = () =>
  createProjectSettingsTools({ userId: owner, repoId })
    .project_env_set as unknown as EnvSet;

async function storedVars() {
  const result = await db.query<{ sandbox_env_vars: Record<string, string> }>(
    "select sandbox_env_vars from repos where id = $1",
    [repoId]
  );
  return result.rows[0]?.sandbox_env_vars;
}

beforeAll(async () => {
  db = await PGlite.create({
    extensions: { vector, pg_trgm, pgcrypto, uuid_ossp },
    parsers: SHIM_TYPE_PARSERS,
  });
  expect(
    (await applyNeonMigrations(db, { log: () => {}, warn: () => {} })).ok
  ).toBe(true);
  await db.query("insert into profiles(id) values ($1)", [owner]);
  const workspace = await db.query<{ id: string }>(
    "insert into workspaces(user_id, name, owner_type, owner_user_id) values ($1, 'Personal', 'user', $1) returning id",
    [owner]
  );
  await db.query(
    "insert into repos(id, full_name, workspace_id, owner_type, owner_user_id, user_id, sandbox_env_vars) values ($1, 'acme/app', $4, 'user', $2, $2, $3)",
    // Two variables, so the stored JSON has a comma and key order to match.
    [
      repoId,
      owner,
      { DATABASE_URL: "postgres://owner@db/app", NODE_ENV: "dev" },
      workspace.rows[0]?.id,
    ]
  );
  const client = createPostgrestShim({
    query: async (sql, values) => {
      if (
        beforeRepoUpdate &&
        /^\s*update\b/i.test(sql) &&
        /\brepos\b/.test(sql)
      ) {
        const hook = beforeRepoUpdate;
        beforeRepoUpdate = null;
        await hook();
      }
      return {
        rows: (await db.query<Record<string, unknown>>(sql, values ?? [])).rows,
      };
    },
  });
  // Only replace the database connection; the tool's queries run for real.
  for (const key of ["from", "rpc"] as const) {
    previous.set(key, Object.getOwnPropertyDescriptor(supabaseAdmin, key));
    Object.defineProperty(supabaseAdmin, key, {
      configurable: true,
      value: client[key].bind(client),
    });
  }
}, 60_000);

afterAll(async () => {
  for (const [key, descriptor] of previous) {
    if (descriptor) Object.defineProperty(supabaseAdmin, key, descriptor);
    else Reflect.deleteProperty(supabaseAdmin, key);
  }
  await db?.close();
});

test("project_env_set compare-and-swap matches a stored jsonb map with several variables", async () => {
  expect(await envSet().execute({ name: "PORT", value: "8000" })).toMatchObject(
    { ok: true, name: "PORT" }
  );
  expect(await storedVars()).toEqual({
    DATABASE_URL: "postgres://owner@db/app",
    NODE_ENV: "dev",
    PORT: "8000",
  });
});

test("project_env_set does not overwrite a change saved after its read", async () => {
  // The operator saves between the tool's read and its write.
  beforeRepoUpdate = () =>
    db.query(
      `update repos set sandbox_env_vars = sandbox_env_vars || '{"OPERATOR":"x"}' where id = $1`,
      [repoId]
    );

  expect(await envSet().execute({ name: "LATE", value: "1" })).toEqual({
    error: "Project variables changed while saving. Try again.",
  });
  expect(beforeRepoUpdate).toBeNull();
  const stored = await storedVars();
  expect(stored).toMatchObject({ OPERATOR: "x" });
  expect(stored).not.toHaveProperty("LATE");
});
