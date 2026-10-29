export type CiAuthFixtureTarget = {
  githubActions: boolean;
  runId: string;
  runAttempt: string;
  branchId: string;
  branch: { id: string; name: string; default?: boolean; protected?: boolean };
  databaseUrl: string;
  sourceDatabaseUrl: string;
};

function endpoint(connectionString: string) {
  try {
    const url = new URL(connectionString);
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !url.hostname.endsWith(".neon.tech")
    ) {
      throw new Error("Unexpected database endpoint");
    }
    return url.hostname.replace(/-pooler(?=\.)/, "");
  } catch {
    throw new Error(
      "CI auth fixtures require explicit Neon database endpoints"
    );
  }
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
    throw new Error(
      "Auth fixtures may only initialize this run's temporary CI branch"
    );
  }
  if (endpoint(target.databaseUrl) === endpoint(target.sourceDatabaseUrl)) {
    throw new Error(
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
