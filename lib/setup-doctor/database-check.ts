import { readdir } from "node:fs/promises";
import { migrationVersion } from "@/lib/db/neon-baseline";
import { getRuntimeDatabaseUrl } from "@/lib/db/connection-urls";
import {
  configured,
  DOCS,
  type DoctorCheckResult,
  type DoctorEnv,
} from "./types";

export type DoctorQuery = (sql: string) => Promise<Record<string, unknown>[]>;

export type DatabaseProbe = {
  /** Connects to `url`, runs the callback, and always disconnects. */
  withConnection: <T>(
    url: string,
    run: (query: DoctorQuery) => Promise<T>
  ) => Promise<T>;
  /** Versions of the files in neon/migrations. */
  listMigrationVersions: () => Promise<string[]>;
};

const ROLE_SQL = `
  select r.rolsuper, r.rolcreaterole,
         current_user = pg_get_userbyid(n.nspowner) as owns_public
  from pg_roles r, pg_namespace n
  where r.rolname = current_user and n.nspname = 'public'`;

export async function listNeonMigrationVersions(
  migrationsDir: string
): Promise<string[]> {
  const versions: string[] = [];
  for (const fileName of await readdir(migrationsDir)) {
    const version = migrationVersion(fileName);
    if (version) versions.push(version);
  }
  return versions.sort();
}

function errorCode(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return error instanceof Error ? error.name : "unknown error";
}

/** Connection, migration ledger, and role privileges, in that order. */
export async function checkDatabase(
  env: DoctorEnv,
  probe: DatabaseProbe
): Promise<DoctorCheckResult> {
  const result = { id: "database", docsUrl: DOCS.databaseAndAuth };
  const url = getRuntimeDatabaseUrl(env);
  if (!url) {
    return {
      ...result,
      status: "fail",
      summary:
        "No database URL: set DATABASE_URL or MOGPLEX_RUNTIME_DATABASE_URL",
    };
  }

  let outcome: DoctorCheckResult;
  try {
    outcome = await probe.withConnection(url, async (query) => {
      let applied: Set<string>;
      try {
        const rows = await query(
          "select version from neon_migrations.schema_migrations"
        );
        applied = new Set(rows.map((row) => String(row.version)));
      } catch {
        return {
          ...result,
          status: "fail" as const,
          summary: "Migrations never ran: run scripts/apply-neon-migrations.ts",
        };
      }
      const pending = (await probe.listMigrationVersions()).filter(
        (version) => !applied.has(version)
      );
      if (pending.length > 0) {
        return {
          ...result,
          status: "fail" as const,
          summary: `${pending.length} pending migration(s), oldest ${pending[0]}`,
        };
      }
      const [role] = await query(ROLE_SQL);
      const privileged = Boolean(
        role?.rolsuper || role?.rolcreaterole || role?.owns_public
      );
      if (privileged && !configured(env, "MOGPLEX_RUNTIME_DATABASE_URL")) {
        return {
          ...result,
          status: "warn" as const,
          summary:
            "Migrations current; app connects as a privileged role (set MOGPLEX_RUNTIME_DATABASE_URL)",
        };
      }
      return {
        ...result,
        status: "pass" as const,
        summary: "Connected; migrations current",
      };
    });
  } catch (error) {
    outcome = {
      ...result,
      status: "fail",
      summary: `Cannot connect to the database (${errorCode(error)})`,
    };
  }
  return outcome;
}
