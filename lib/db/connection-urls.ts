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
