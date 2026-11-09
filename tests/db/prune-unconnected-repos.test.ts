import { copyFile, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { afterAll, beforeAll, expect, it } from "vitest";
import { applyNeonMigrations } from "@/lib/db/neon-migrations";

const root = path.resolve(import.meta.dirname, "../..");
const migrationName = "20261109180000_prune_unconnected_repos.sql";

let db: PGlite;
let scratch: string;
const workspaces = new Map<string, string>();
const user = crypto.randomUUID();
const other = crypto.randomUUID();

async function account(id: string, email: string) {
  await db.query(
    'insert into public."user" (id,name,email,"emailVerified","updatedAt") values ($1,$2,$3,true,now())',
    [id, "Person", email]
  );
  await db.query(
    "insert into public.profiles (id,auth_user_id,email) values ($1,$1,$2)",
    [id, email]
  );
}

async function repo(
  fullName: string,
  options: { owner?: string; installationId?: number; teamId?: string } = {}
) {
  const owner = options.owner ?? user;
  const { rows } = await db.query<{ id: string }>(
    `insert into public.repos
       (user_id, full_name, workspace_id, owner_type, owner_user_id, product_team_id, github_installation_id)
     values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [
      owner,
      fullName,
      workspaces.get(owner),
      options.teamId ? "team" : "user",
      options.teamId ? null : owner,
      options.teamId ?? null,
      options.installationId ?? null,
    ]
  );
  return rows[0].id;
}

async function remaining() {
  const { rows } = await db.query<{ full_name: string }>(
    "select full_name from public.repos order by full_name"
  );
  return rows.map((row) => row.full_name);
}

beforeAll(async () => {
  db = await PGlite.create({
    extensions: { vector, pg_trgm, pgcrypto, uuid_ossp },
  });
  scratch = await mkdtemp(path.join(tmpdir(), "mogplex-prune-repos-"));
  const migrationsDir = path.join(root, "neon/migrations");
  for (const file of await readdir(migrationsDir)) {
    if (file.localeCompare(migrationName) < 0)
      await copyFile(path.join(migrationsDir, file), path.join(scratch, file));
  }
  const previous = await applyNeonMigrations(db, {
    migrationsDir: scratch,
    baselinePath: path.join(root, "neon/baseline.sql"),
    log: () => {},
    warn: () => {},
  });
  expect(previous.ok).toBe(true);
  // The baseline has no API roles; create them so the migration's revoke for
  // them runs, as it does on databases that have them.
  await db.exec("create role anon; create role authenticated");
  await db.exec(
    await readFile(path.join(migrationsDir, migrationName), "utf8")
  );
  await account(user, "user@example.com");
  await account(other, "other@example.com");
  for (const id of [user, other]) {
    const { rows } = await db.query<{ id: string }>(
      "insert into public.workspaces (user_id, owner_user_id, name) values ($1, $1, 'Personal') returning id",
      [id]
    );
    workspaces.set(id, rows[0].id);
  }
});

afterAll(async () => {
  await db.close();
  await rm(scratch, { recursive: true, force: true });
});

it("deletes only the user's unreferenced personal repositories without a GitHub App installation", async () => {
  await repo("legacy/unused");
  await repo("legacy/unused-two");
  await repo("me/connected", { installationId: 42 });
  await repo("other/legacy", { owner: other });

  const sandboxed = await repo("legacy/sandboxed");
  await db.query(
    "insert into public.sandboxes (user_id, repo_id, sandbox_id) values ($1,$2,'sbx-1')",
    [user, sandboxed]
  );
  const discussed = await repo("legacy/discussed");
  await db.query(
    "insert into public.conversations (id, user_id, repo_id) values ('conv-1',$1,$2)",
    [user, discussed]
  );
  const billed = await repo("legacy/billed");
  await db.query(
    "insert into public.ai_calls (user_id, repo_id, model, type) values ($1,$2,'model','chat')",
    [user, billed]
  );
  const assigned = await repo("legacy/assigned");
  await db.query(
    "insert into public.assignments (repo_id, type) values ($1,'pr_review')",
    [assigned]
  );
  const parent = await repo("legacy/parent");
  await db.query(
    "update public.repos set parent_repo_id = $1 where full_name = 'me/connected'",
    [parent]
  );
  await repo("legacy/session-by-name");
  await db.query(
    "insert into public.control_sessions (user_id, project) values ($1,'legacy/session-by-name')",
    [user]
  );
  const queued = await repo("legacy/queued");
  await db.query(
    "insert into public.job_runs (status, metadata) values ('pending',$1)",
    [{ repo_id: queued }]
  );
  // Settings the user stored on the row itself.
  await repo("legacy/with-env");
  await repo("legacy/with-install");
  await repo("legacy/favorite");
  await db.exec(
    `update public.repos set sandbox_env_vars = '{"API_URL":"x"}'::jsonb where full_name = 'legacy/with-env';
     update public.repos set install_command = 'pnpm install' where full_name = 'legacy/with-install';
     update public.repos set is_favorite = true where full_name = 'legacy/favorite'`
  );

  // pg_dump's baseline omits role attributes and ACLs; run as the server role.
  await db.exec(
    "alter role service_role bypassrls; grant usage on schema public to service_role; grant select, insert, update, delete on all tables in schema public to service_role; set role service_role"
  );
  const { rows } = await db.query<{ deleted: number }>(
    "select public.prune_unconnected_repos($1) as deleted",
    [user]
  );
  await db.exec("reset role");

  expect(rows[0].deleted).toBe(2);
  expect(await remaining()).toEqual([
    "legacy/assigned",
    "legacy/billed",
    "legacy/discussed",
    "legacy/favorite",
    "legacy/parent",
    "legacy/queued",
    "legacy/sandboxed",
    "legacy/session-by-name",
    "legacy/with-env",
    "legacy/with-install",
    "me/connected",
    "other/legacy",
  ]);
  expect(
    (
      await db.query("select 1 from public.sandboxes where repo_id = $1", [
        sandboxed,
      ])
    ).rows
  ).toHaveLength(1);
});

it("guards every foreign key into repos", async () => {
  const { rows } = await db.query<{ table_name: string }>(
    `select distinct conrelid::regclass::text as table_name
       from pg_constraint
      where contype = 'f' and confrelid = 'public.repos'::regclass`
  );
  const definition = (
    await db.query<{ def: string }>(
      "select pg_get_functiondef('public.prune_unconnected_repos(uuid)'::regprocedure) as def"
    )
  ).rows[0].def;
  const unguarded = rows
    .map((row) => row.table_name.replace(/^public\./, ""))
    .filter((table) => !definition.includes(`public.${table} x`));
  expect(unguarded).toEqual([]);
});

it("is not executable by the API roles", async () => {
  const { rows } = await db.query<{ role: string; allowed: boolean }>(
    `select r.rolname as role,
            has_function_privilege(r.rolname, 'public.prune_unconnected_repos(uuid)', 'execute') as allowed
       from pg_roles r where r.rolname in ('anon', 'authenticated', 'service_role')
      order by 1`
  );
  expect(rows).toEqual([
    { role: "anon", allowed: false },
    { role: "authenticated", allowed: false },
    { role: "service_role", allowed: true },
  ]);
});
