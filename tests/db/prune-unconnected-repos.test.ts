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
  // This change's migrations: the function and its guard indexes.
  for (const name of (await readdir(migrationsDir))
    .filter((file) => file.includes("prune_unconnected_repos"))
    .sort())
    await db.exec(await readFile(path.join(migrationsDir, name), "utf8"));
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

it("returns before evaluating the guard when the user has no candidate rows", async () => {
  const idle = crypto.randomUUID();
  // With the guard's tables unreachable, evaluating it would fail; returning
  // early for a user with nothing to prune must not touch them.
  await db.exec("begin; alter table public.job_runs rename to job_runs_moved");
  try {
    const { rows } = await db.query<{ deleted: number }>(
      "select public.prune_unconnected_repos($1) as deleted",
      [idle]
    );
    expect(rows[0].deleted).toBe(0);
  } finally {
    await db.exec("rollback");
  }
});

/** Each `not exists (select 1 from public.<table> x where ...)` guard, by table. */
async function guardsByTable() {
  const definition = (
    await db.query<{ def: string }>(
      "select pg_get_functiondef('public.prune_unconnected_repos(uuid)'::regprocedure) as def"
    )
  ).rows[0].def;
  const guards = new Map<string, string>();
  for (const match of definition.matchAll(
    /select 1 from public\.(\w+) x\s+where ([^)]*)\)/g
  )) {
    guards.set(match[1], `${guards.get(match[1]) ?? ""} ${match[2]}`);
  }
  return guards;
}

function unguarded(
  columns: Array<{ table_name: string; column_name: string }>,
  guards: Map<string, string>
) {
  return columns
    .map(({ table_name, column_name }) => ({
      table: table_name.replace(/^public\./, ""),
      column: column_name,
    }))
    .filter(
      ({ table, column }) => !guards.get(table)?.includes(`x.${column} = r.id`)
    )
    .map(({ table, column }) => `${table}.${column}`);
}

it("guards every foreign key into repos by its own column", async () => {
  const { rows } = await db.query<{ table_name: string; column_name: string }>(
    `select k.conrelid::regclass::text as table_name, a.attname as column_name
       from pg_constraint k
       join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any (k.conkey)
      where k.contype = 'f' and k.confrelid = 'public.repos'::regclass`
  );
  expect(rows.length).toBeGreaterThan(0);
  expect(unguarded(rows, await guardsByTable())).toEqual([]);
});

it("guards every repo_id column that has no foreign key", async () => {
  const { rows } = await db.query<{ table_name: string; column_name: string }>(
    `select c.table_name, c.column_name
       from information_schema.columns c
       join information_schema.tables t using (table_schema, table_name)
      where c.table_schema = 'public'
        and t.table_type = 'BASE TABLE'
        and c.column_name like '%repo_id%'
        and not exists (
          select 1
            from pg_constraint k
            join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any (k.conkey)
           where k.contype = 'f'
             and k.confrelid = 'public.repos'::regclass
             and k.conrelid = format('public.%I', c.table_name)::regclass
             and a.attname = c.column_name
        )`
  );
  expect(rows.map((row) => row.table_name).sort()).toContain(
    "control_sessions"
  );
  expect(unguarded(rows, await guardsByTable())).toEqual([]);
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

it("probes every guard column through an index", async () => {
  // The guard runs on every App sync while any candidate row remains (a
  // referenced legacy row stays a candidate), so each probe must be an index
  // lookup rather than a scan of the referencing table.
  const { rows } = await db.query<{ table_name: string; leading: string }>(
    `select i.indrelid::regclass::text as table_name,
            pg_get_indexdef(i.indexrelid, 1, true) as leading
       from pg_index i
      where i.indrelid::regclass::text like 'public.%'
         or i.indrelid::regclass::text not like '%.%'`
  );
  const indexed = new Set(
    rows.map(
      (row) => `${row.table_name.replace(/^public\./, "")}:${row.leading}`
    )
  );
  const missing: string[] = [];
  for (const [table, predicates] of await guardsByTable()) {
    for (const match of predicates.matchAll(/x\.(\w+)(->>'\w+')?\s*=/g)) {
      const leading = match[2]
        ? `(${match[1]} ->> '${match[2].slice(4, -1)}'::text)`
        : match[1];
      if (!indexed.has(`${table}:${leading}`))
        missing.push(`${table}.${match[1]}${match[2] ?? ""}`);
    }
  }
  expect(missing).toEqual([]);
});

/**
 * Text columns that look like repository references but do not point at a
 * repos row, with the reason. A new reference by name must be guarded in
 * prune_unconnected_repos instead of added here.
 */
const NAME_COLUMNS_NOT_GUARDED = new Map<string, string>([
  [
    "github_merge_approvals.target_repo",
    "a GitHub pull request's repository name (with target_owner), not a repos row",
  ],
]);

it("guards or explains every column that names a repository", async () => {
  const { rows } = await db.query<{ table_name: string; column_name: string }>(
    `select c.table_name, c.column_name
       from information_schema.columns c
       join information_schema.tables t using (table_schema, table_name)
      where c.table_schema = 'public'
        and t.table_type = 'BASE TABLE'
        and c.data_type in ('text', 'character varying')
        and (c.column_name like '%repo%' or c.column_name = 'project')
      order by 1, 2`
  );
  const guards = await guardsByTable();
  const unexplained = rows
    .map(({ table_name, column_name }) => `${table_name}.${column_name}`)
    .filter((column) => {
      const [table, name] = column.split(".");
      return (
        !guards.get(table)?.includes(`x.${name} = r.full_name`) &&
        !NAME_COLUMNS_NOT_GUARDED.has(column)
      );
    });
  expect(unexplained).toEqual([]);
});

/**
 * repos columns the settings guard does not check, with the reason. A new
 * column a user can set must be checked in prune_unconnected_repos instead.
 */
const GITHUB_METADATA = "copied from GitHub or set at import, not by the user";
const SNAPSHOT_BOOKKEEPING = "snapshot bookkeeping; snapshot_id is checked";
const VERCEL_LINK_STATUS = "Vercel link status; vercel_project_id is checked";
const REPO_COLUMNS_NOT_SETTINGS = new Map<string, string>([
  ["user_id", GITHUB_METADATA],
  ["github_id", GITHUB_METADATA],
  ["created_at", GITHUB_METADATA],
  ["owner", GITHUB_METADATA],
  ["name", GITHUB_METADATA],
  ["default_branch", GITHUB_METADATA],
  ["workspace_id", GITHUB_METADATA],
  ["created_by_user_id", GITHUB_METADATA],
  ["is_hidden", "hidden legacy rows are deleted on purpose"],
  ["snapshot_build_started_at", SNAPSHOT_BOOKKEEPING],
  ["snapshot_billing_source", SNAPSHOT_BOOKKEEPING],
  ["snapshot_billing_team_id", SNAPSHOT_BOOKKEEPING],
  ["snapshot_billing_project_id", SNAPSHOT_BOOKKEEPING],
  ["snapshot_lockfile_hash", SNAPSHOT_BOOKKEEPING],
  ["snapshot_commit_sha", SNAPSHOT_BOOKKEEPING],
  ["vercel_link_status", VERCEL_LINK_STATUS],
  ["vercel_link_checked_at", VERCEL_LINK_STATUS],
  ["vercel_link_error_code", VERCEL_LINK_STATUS],
  ["vercel_link_message", VERCEL_LINK_STATUS],
]);

it("checks or explains every repos column in the settings guard", async () => {
  const definition = (
    await db.query<{ def: string }>(
      "select pg_get_functiondef('public.prune_unconnected_repos(uuid)'::regprocedure) as def"
    )
  ).rows[0].def;
  const { rows } = await db.query<{ column_name: string }>(
    `select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'repos'
      order by ordinal_position`
  );
  const unexplained = rows
    .map((row) => row.column_name)
    .filter(
      (column) =>
        !new RegExp(`\\br\\.${column}\\b`).test(definition) &&
        !REPO_COLUMNS_NOT_SETTINGS.has(column)
    );
  expect(unexplained).toEqual([]);
});
