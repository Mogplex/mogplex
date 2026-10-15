type DatabaseUrlEnvironment = Readonly<Record<string, string | undefined>>;

function firstConfigured(...values: Array<string | undefined>): string {
  return values.find((value) => value?.trim())?.trim() ?? "";
}

/**
 * Resolve the pooled connection used by the serving application. Production
 * should set MOGPLEX_RUNTIME_DATABASE_URL to a least-privilege Neon role;
 * DATABASE_URL and the managed-integration alias remain development/CI
 * fallbacks and are also used by the migration tooling.
 */
export function getRuntimeDatabaseUrl(
  env: DatabaseUrlEnvironment = process.env
): string {
  return firstConfigured(
    env.MOGPLEX_RUNTIME_DATABASE_URL,
    env.DATABASE_URL,
    env.mogplex_DATABASE_URL
  );
}

/** Resolve the direct connection required by LISTEN clients. */
export function getRuntimeUnpooledDatabaseUrl(
  env: DatabaseUrlEnvironment = process.env
): string {
  return firstConfigured(
    env.MOGPLEX_RUNTIME_DATABASE_URL_UNPOOLED,
    env.DATABASE_URL_UNPOOLED,
    env.mogplex_DATABASE_URL_UNPOOLED,
    env.MOGPLEX_RUNTIME_DATABASE_URL,
    env.DATABASE_URL,
    env.mogplex_DATABASE_URL
  );
}

/** The host name of docker-compose.yml's bundled Postgres service. */
export const BUNDLED_POSTGRES_HOST = "postgres";

/**
 * Explain a failed connection to Docker Compose's bundled Postgres when that
 * service is not running: its `postgres` profile is off and no external
 * DATABASE_URL is set, so the default URL points at a host that does not
 * exist. Returns null for every other error.
 */
export function describeMissingBundledPostgres(
  error: unknown,
  connectionString: string
): string | null {
  const code =
    error && typeof error === "object" && "code" in error
      ? error.code
      : undefined;
  if (code !== "ENOTFOUND" && code !== "EAI_AGAIN") return null;

  let hostname: string;
  try {
    hostname = new URL(connectionString).hostname;
  } catch {
    return null;
  }
  if (hostname !== BUNDLED_POSTGRES_HOST) return null;

  return [
    `Cannot reach the bundled Postgres at host "${BUNDLED_POSTGRES_HOST}".`,
    "Set COMPOSE_PROFILES=postgres in .env to run it, or set DATABASE_URL",
    "and DATABASE_URL_UNPOOLED to an external database.",
  ].join(" ");
}
