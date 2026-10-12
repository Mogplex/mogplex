import { NextResponse } from "next/server";
import { getRuntimeDatabaseUrl } from "@/lib/db/connection-urls";
import { buildHealthReport, probeDatabase } from "@/lib/health";

export const dynamic = "force-dynamic";

type HealthRouteDeps = {
  env: Readonly<Record<string, string | undefined>>;
  databaseUrl: () => string;
  queryDatabase: () => Promise<unknown>;
};

async function queryNeonDatabase() {
  const { getNeonPool } = await import("@/lib/db/pool");
  return getNeonPool().query("select 1");
}

/**
 * Unauthenticated liveness and readiness probe for container orchestrators.
 * It returns 503 when the database is unreachable or unconfigured, and it
 * never includes credential values or error details.
 */
export function createHealthGetHandler(
  overrides: Partial<HealthRouteDeps> = {}
) {
  const deps: HealthRouteDeps = {
    env: process.env,
    databaseUrl: () => getRuntimeDatabaseUrl(),
    queryDatabase: queryNeonDatabase,
    ...overrides,
  };

  return async function GET() {
    const database = await probeDatabase({
      databaseUrl: deps.databaseUrl(),
      query: deps.queryDatabase,
    });
    const report = buildHealthReport(database, deps.env);

    return NextResponse.json(report, {
      status: database === "ok" ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    });
  };
}

export const GET = createHealthGetHandler();
