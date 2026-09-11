// Applies neon/migrations/*.sql in filename order, tracking applied versions
// in neon_migrations.schema_migrations. An empty database is first
// bootstrapped from neon/baseline.sql, which stands in for every migration up
// to the version recorded in its header.
//
// Each migration runs in its own transaction: statements that cannot run
// inside one (CREATE INDEX CONCURRENTLY, …) must be applied out of band.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  migrationVersion,
  parseBaselineThroughVersion,
} from "@/lib/db/neon-baseline";

// Satisfied by a node-postgres Client (query without values uses the simple
// protocol, so multi-statement files work) and by PGlite in tests.
export type MigrationDatabase = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
  exec: (sql: string) => Promise<unknown>;
};

export type ApplyNeonMigrationsOptions = {
  dryRun?: boolean;
  migrationsDir?: string;
  baselinePath?: string;
  log?: (message: string) => void;
  warn?: (message: string) => void;
};

export type ApplyNeonMigrationsResult = {
  ok: boolean;
  baseline: "applied" | "planned" | "skipped";
  applied: string[];
  failed?: string;
};

type ResolvedOptions = Required<ApplyNeonMigrationsOptions>;
type MigrationFile = { fileName: string; version: string };

const LEDGER_SQL = `
  create schema if not exists neon_migrations;
  create table if not exists neon_migrations.schema_migrations (
    version text primary key,
    applied_at timestamptz not null default now()
  );
`;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function listMigrationFiles(
  migrationsDir: string,
  warn: (message: string) => void
): Promise<MigrationFile[]> {
  const files: MigrationFile[] = [];
  for (const fileName of [...(await readdir(migrationsDir))].sort()) {
    const version = migrationVersion(fileName);
    if (!version) {
      warn(`skipping non-migration file: ${fileName}`);
      continue;
    }
    files.push({ fileName, version });
  }
  return files;
}

async function appliedVersions(db: MigrationDatabase): Promise<Set<string>> {
  const { rows } = await db.query(
    "select version from neon_migrations.schema_migrations"
  );
  return new Set(
    (rows as Array<{ version: string }>).map((row) => String(row.version))
  );
}

async function hasPublicTables(db: MigrationDatabase): Promise<boolean> {
  const { rows } = await db.query(
    "select exists (select 1 from pg_catalog.pg_tables where schemaname = 'public') as found"
  );
  return (rows as Array<{ found: boolean }>)[0]?.found;
}

async function readBaseline(
  baselinePath: string
): Promise<{ sql: string; through: string } | null> {
  let sql: string;
  try {
    sql = await readFile(baselinePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
  const through = parseBaselineThroughVersion(sql);
  if (!through) {
    throw new Error(`${baselinePath} has no "baseline-through" header`);
  }
  return { sql, through };
}

type BaselineOutcome = {
  ok: boolean;
  status: ApplyNeonMigrationsResult["baseline"];
  seeded: string[];
};

async function bootstrapFromBaseline(
  db: MigrationDatabase,
  files: MigrationFile[],
  options: ResolvedOptions
): Promise<BaselineOutcome> {
  const baseline = await readBaseline(options.baselinePath);
  if (!baseline) {
    options.warn(
      `empty database and no baseline at ${options.baselinePath}; applying every migration from scratch`
    );
    return { ok: true, status: "skipped", seeded: [] };
  }

  const through = Number(baseline.through);
  const seeded = files
    .filter((file) => Number(file.version) <= through)
    .map((file) => file.version);
  const label = `${path.basename(options.baselinePath)} (covers ${seeded.length} migration(s) through ${baseline.through})`;

  if (options.dryRun) {
    options.log(`empty database: would apply ${label}`);
    return { ok: true, status: "planned", seeded };
  }

  try {
    await db.query("begin");
    await db.exec(baseline.sql);
    await db.query(
      `insert into neon_migrations.schema_migrations (version)
         select unnest($1::text[])
         on conflict (version) do nothing`,
      [seeded]
    );
    await db.query("commit");
    options.log(`empty database: applied ${label}`);
    return { ok: true, status: "applied", seeded };
  } catch (error) {
    await db.query("rollback").catch(() => undefined);
    options.warn(`failed applying baseline: ${errorMessage(error)}`);
    return { ok: false, status: "skipped", seeded: [] };
  }
}

async function applyOne(
  db: MigrationDatabase,
  filePath: string,
  version: string
): Promise<string | null> {
  const sql = await readFile(filePath, "utf8");
  try {
    await db.query("begin");
    await db.exec(sql);
    await db.query(
      "insert into neon_migrations.schema_migrations (version) values ($1)",
      [version]
    );
    await db.query("commit");
    return null;
  } catch (error) {
    await db.query("rollback").catch(() => undefined);
    return errorMessage(error);
  }
}

async function applyPendingFiles(
  db: MigrationDatabase,
  files: MigrationFile[],
  applied: Set<string>,
  options: ResolvedOptions
): Promise<{ applied: string[]; failed?: string }> {
  const done: string[] = [];
  for (const file of files) {
    if (applied.has(file.version)) {
      continue;
    }
    if (options.dryRun) {
      options.log(`would apply ${file.fileName}`);
      done.push(file.fileName);
      continue;
    }
    const failure = await applyOne(
      db,
      path.join(options.migrationsDir, file.fileName),
      file.version
    );
    if (failure) {
      options.warn(`failed applying ${file.fileName}: ${failure}`);
      return { applied: done, failed: file.fileName };
    }
    options.log(`applied ${file.fileName}`);
    done.push(file.fileName);
  }
  return { applied: done };
}

function resolveOptions(options: ApplyNeonMigrationsOptions): ResolvedOptions {
  return {
    dryRun: options.dryRun ?? false,
    migrationsDir:
      options.migrationsDir ?? path.join(process.cwd(), "neon", "migrations"),
    baselinePath:
      options.baselinePath ?? path.join(process.cwd(), "neon", "baseline.sql"),
    log: options.log ?? console.log,
    warn: options.warn ?? console.warn,
  };
}

export async function applyNeonMigrations(
  db: MigrationDatabase,
  options: ApplyNeonMigrationsOptions = {}
): Promise<ApplyNeonMigrationsResult> {
  const resolved = resolveOptions(options);

  await db.exec(LEDGER_SQL);
  const files = await listMigrationFiles(resolved.migrationsDir, resolved.warn);
  const applied = await appliedVersions(db);
  const result: ApplyNeonMigrationsResult = {
    ok: true,
    baseline: "skipped",
    applied: [],
  };

  if (applied.size === 0 && !(await hasPublicTables(db))) {
    const outcome = await bootstrapFromBaseline(db, files, resolved);
    if (!outcome.ok) {
      return {
        ...result,
        ok: false,
        failed: path.basename(resolved.baselinePath),
      };
    }
    result.baseline = outcome.status;
    for (const version of outcome.seeded) {
      applied.add(version);
    }
  }

  const pending = await applyPendingFiles(db, files, applied, resolved);
  result.applied = pending.applied;
  if (pending.failed) {
    return { ...result, ok: false, failed: pending.failed };
  }

  const count = result.applied.length;
  resolved.log(
    count === 0
      ? "no pending Neon migrations"
      : `${count} migration(s) ${resolved.dryRun ? "pending" : "applied"}`
  );
  return result;
}
