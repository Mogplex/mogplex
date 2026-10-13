export type DatabaseHealth = "ok" | "error" | "unconfigured";
export type SubsystemHealth = "configured" | "unconfigured";

export type HealthReport = {
  status: "ok" | "degraded";
  checks: {
    database: DatabaseHealth;
    githubApp: SubsystemHealth;
    trigger: SubsystemHealth;
    sandboxes: SubsystemHealth;
    models: SubsystemHealth;
    slack: SubsystemHealth;
  };
};

export type HealthEnvironment = Readonly<Record<string, string | undefined>>;

export const HEALTH_DATABASE_TIMEOUT_MS = 2000;

function hasAll(env: HealthEnvironment, ...names: string[]) {
  return names.every((name) => Boolean(env[name]?.trim()));
}

function hasAny(env: HealthEnvironment, ...names: string[]) {
  return names.some((name) => Boolean(env[name]?.trim()));
}

function subsystem(configured: boolean): SubsystemHealth {
  return configured ? "configured" : "unconfigured";
}

/**
 * Report which optional subsystems have credentials. Only presence is
 * reported, never a value, so the result is safe to serve anonymously.
 */
export function readSubsystemHealth(
  env: HealthEnvironment
): Omit<HealthReport["checks"], "database"> {
  return {
    githubApp: subsystem(
      hasAll(env, "GITHUB_APP_ID", "GITHUB_APP_PRIVATE_KEY", "GITHUB_APP_NAME")
    ),
    trigger: subsystem(
      hasAny(env, "TRIGGER_SECRET_KEY", "TRIGGER_ACCESS_TOKEN")
    ),
    sandboxes: subsystem(
      hasAll(env, "PLATFORM_VERCEL_TOKEN") &&
        hasAny(env, "VERCEL_PROJECT_ID", "PLATFORM_VERCEL_PROJECT_ID")
    ),
    models: subsystem(hasAll(env, "AI_GATEWAY_API_KEY")),
    slack: subsystem(
      hasAll(
        env,
        "SLACK_CLIENT_ID",
        "SLACK_CLIENT_SECRET",
        "SLACK_SIGNING_SECRET"
      )
    ),
  };
}

/**
 * Run a database probe with a deadline. Any failure, including a slow
 * database, reports `error` without the underlying message.
 */
export async function probeDatabase(input: {
  databaseUrl: string;
  query: () => Promise<unknown>;
  timeoutMs?: number;
}): Promise<DatabaseHealth> {
  if (!input.databaseUrl.trim()) return "unconfigured";

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<"error">((resolve) => {
    timer = setTimeout(
      () => resolve("error"),
      input.timeoutMs ?? HEALTH_DATABASE_TIMEOUT_MS
    );
  });

  try {
    return await Promise.race([
      input.query().then(() => "ok" as const),
      deadline,
    ]);
  } catch {
    return "error";
  } finally {
    clearTimeout(timer);
  }
}

export function buildHealthReport(
  database: DatabaseHealth,
  env: HealthEnvironment
): HealthReport {
  return {
    status: database === "ok" ? "ok" : "degraded",
    checks: { database, ...readSubsystemHealth(env) },
  };
}
