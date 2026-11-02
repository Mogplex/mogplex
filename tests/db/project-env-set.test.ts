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

test("project_env_set keeps a change saved after its read and retries on top of it", async () => {
  // The operator saves between the tool's read and its write.
  beforeRepoUpdate = () =>
    db.query(
      `update repos set sandbox_env_vars = sandbox_env_vars || '{"OPERATOR":"x"}' where id = $1`,
      [repoId]
    );

  expect(await envSet().execute({ name: "LATE", value: "1" })).toMatchObject({
    ok: true,
    name: "LATE",
  });
  expect(beforeRepoUpdate).toBeNull();
  expect(await storedVars()).toMatchObject({ OPERATOR: "x", LATE: "1" });
});

test("project_env_set calls made in the same step both land", async () => {
  const [first, second] = await Promise.all([
    envSet().execute({ name: "SIBLING_A", value: "a" }),
    envSet().execute({ name: "SIBLING_B", value: "b" }),
  ]);

  expect(first).toMatchObject({ ok: true });
  expect(second).toMatchObject({ ok: true });
  expect(await storedVars()).toMatchObject({ SIBLING_A: "a", SIBLING_B: "b" });
});

test("project_env_set compare-and-swap holds for '::' values and a large map", async () => {
  // Filters reach Postgres as bound parameters, not a URL, so neither a
  // PostgREST cast separator nor the map's size can break the match.
  const large = Object.fromEntries(
    Array.from({ length: 300 }, (_, index) => [
      `BULK_${index}`,
      "v".repeat(400),
    ])
  );
  await db.query("update repos set sandbox_env_vars = $2 where id = $1", [
    repoId,
    { ...large, BIND: "[::1]:8080", CAST: "a::text" },
  ]);

  expect(
    await envSet().execute({ name: "AFTER_LARGE", value: "1" })
  ).toMatchObject({ ok: true });
  expect(await storedVars()).toMatchObject({
    BIND: "[::1]:8080",
    CAST: "a::text",
    AFTER_LARGE: "1",
    BULK_299: "v".repeat(400),
  });
});

test("project_settings_update matches its read through the real shim and catches a concurrent save", async () => {
  const update = () =>
    (
      createProjectSettingsTools({ userId: owner, repoId })
        .project_settings_update as unknown as EnvSet
    ).execute({ devCommand: "npm run dev", devPort: 5173 });

  expect(await update()).toMatchObject({
    ok: true,
    settings: { devCommand: "npm run dev", devPort: 5173, devPortAuto: false },
  });

  await db.query(
    "update repos set dev_command = null, dev_port_auto = true where id = $1",
    [repoId]
  );
  beforeRepoUpdate = () =>
    db.query("update repos set dev_command = 'make serve' where id = $1", [
      repoId,
    ]);
  expect(await update()).toEqual({
    error: "Project settings changed while saving. Try again.",
  });
  const stored = await db.query<{ dev_command: string }>(
    "select dev_command from repos where id = $1",
    [repoId]
  );
  expect(stored.rows[0]?.dev_command).toBe("make serve");
});

test("project_settings_update clears a pinned port through the real shim", async () => {
  await db.query(
    "update repos set dev_port = 8000, dev_port_auto = false where id = $1",
    [repoId]
  );
  const update = (input: Record<string, unknown>) =>
    (
      createProjectSettingsTools({ userId: owner, repoId })
        .project_settings_update as unknown as EnvSet
    ).execute(input);

  expect(await update({ devPort: null, replace: true })).toMatchObject({
    ok: true,
    settings: { devPort: null, devPortAuto: true },
  });

  // The operator pins a port again between the tool's read and its write.
  beforeRepoUpdate = () =>
    db.query("update repos set dev_port_auto = false where id = $1", [repoId]);
  expect(await update({ devPort: 5173 })).toEqual({
    error: "Project settings changed while saving. Try again.",
  });
  const stored = await db.query<{ dev_port: number; dev_port_auto: boolean }>(
    "select dev_port, dev_port_auto from repos where id = $1",
    [repoId]
  );
  expect(stored.rows[0]).toEqual({ dev_port: 8000, dev_port_auto: false });
});
