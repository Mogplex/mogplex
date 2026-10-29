export type CiAuthFixtureTarget = {
  githubActions: boolean;
  runId: string;
  runAttempt: string;
  branchId: string;
  branch: { id: string; name: string; default?: boolean; protected?: boolean };
  databaseUrl: string;
  sourceDatabaseUrl: string;
};

/** Only authored, credential-free diagnostics belong in this error class. */
export class CiAuthFixtureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CiAuthFixtureError";
  }
}

function neonUrl(connectionString: string) {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new CiAuthFixtureError("Neon database URL is invalid");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new CiAuthFixtureError("CI auth fixtures require PostgreSQL URLs");
  }
  if (!url.hostname.endsWith(".neon.tech")) {
    throw new CiAuthFixtureError("CI auth fixtures require Neon endpoints");
  }
  return url;
}

function endpoint(connectionString: string) {
  return neonUrl(connectionString).hostname.replace(/-pooler(?=\.)/, "");
}

export function ciConnectionParams(sourceUrl: string, branchId: string) {
  if (!branchId) {
    throw new CiAuthFixtureError("A temporary Neon branch id is required");
  }
  const source = neonUrl(sourceUrl);
  let databaseName: string;
  let roleName: string;
  try {
    databaseName = decodeURIComponent(source.pathname.slice(1));
    roleName = decodeURIComponent(source.username);
  } catch {
    throw new CiAuthFixtureError(
      "Source database name and role must be valid URI components"
    );
  }
  if (!databaseName) {
    throw new CiAuthFixtureError("Source Neon database name is required");
  }
  if (!roleName) {
    throw new CiAuthFixtureError("Source Neon role name is required");
  }
  return new URLSearchParams({
    branch_id: branchId,
    database_name: databaseName,
    role_name: roleName,
    pooled: "false",
  });
}

export function assertCiAuthFixtureTarget(target: CiAuthFixtureTarget) {
  if (
    !target.githubActions ||
    !/^\d+$/.test(target.runId) ||
    !/^\d+$/.test(target.runAttempt) ||
    !target.branchId ||
    target.branch.id !== target.branchId ||
    target.branch.name !== `ci-run-${target.runId}-${target.runAttempt}` ||
    target.branch.default ||
    target.branch.protected
  ) {
    throw new CiAuthFixtureError(
      "Auth fixtures may only initialize this run's temporary CI branch"
    );
  }
  if (endpoint(target.databaseUrl) === endpoint(target.sourceDatabaseUrl)) {
    throw new CiAuthFixtureError(
      "Auth fixtures must never reset the source database's keys"
    );
  }
}

/** Run once before any browser shard, never on the shared database fallback. */
export async function prepareCiAuthFixture(
  db: { exec: (sql: string) => Promise<unknown> },
  target: CiAuthFixtureTarget
) {
  assertCiAuthFixtureTarget(target);
  // The fork copies production ciphertext, but CI uses a fixture-only secret.
  // Let the native provider create keys encrypted with that fixture secret.
  await db.exec("DELETE FROM public.jwks");
}
