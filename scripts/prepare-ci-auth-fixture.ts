import { Client } from "pg";
import { z } from "zod";
import {
  assertCiAuthFixtureTarget,
  CiAuthFixtureError,
  ciConnectionParams,
  prepareCiAuthFixture,
} from "../lib/db/ci-auth-fixture";

async function main() {
  const project = process.env.NEON_PROJECT_ID;
  const apiKey = process.env.NEON_API_KEY;
  const branchId = process.env.CI_NEON_BRANCH_ID;
  const sourceDatabaseUrl = process.env.SOURCE_DATABASE_URL;
  if (!project || !apiKey || !branchId || !sourceDatabaseUrl) {
    throw new CiAuthFixtureError(
      "CI branch identity and source database configuration are required"
    );
  }
  const query = ciConnectionParams(sourceDatabaseUrl, branchId);
  const headers = { Authorization: `Bearer ${apiKey}` };
  const base = `https://console.neon.tech/api/v2/projects/${encodeURIComponent(project)}`;
  const metadata = await fetch(
    `${base}/branches/${encodeURIComponent(branchId)}`,
    { headers, signal: AbortSignal.timeout(15_000) }
  );
  if (!metadata.ok)
    throw new CiAuthFixtureError(
      `Could not verify the temporary CI branch (HTTP ${metadata.status})`
    );
  const { branch } = z
    .object({
      branch: z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        default: z.boolean().optional(),
        protected: z.boolean().optional(),
      }),
    })
    .parse(await metadata.json());

  // Resolve the target from the verified branch, not an inherited DATABASE_URL.
  const connection = await fetch(`${base}/connection_uri?${query}`, {
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  if (!connection.ok)
    throw new CiAuthFixtureError(
      `Could not resolve the temporary CI database (HTTP ${connection.status})`
    );
  const { uri: databaseUrl } = z
    .object({ uri: z.string().min(1) })
    .parse(await connection.json());
  const target = {
    githubActions: process.env.GITHUB_ACTIONS === "true",
    runId: process.env.GITHUB_RUN_ID ?? "",
    runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? "",
    branchId,
    branch,
    databaseUrl,
    sourceDatabaseUrl,
  };
  assertCiAuthFixtureTarget(target);
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await prepareCiAuthFixture({ exec: (sql) => client.query(sql) }, target);
    console.log(
      "Initialized signing-key storage in the verified temporary CI branch"
    );
  } finally {
    await client.end();
  }
}

// eslint-disable-next-line unicorn/prefer-top-level-await
main().catch((error: unknown) => {
  // Never echo connection URIs, provider responses, or copied key material.
  console.error(
    error instanceof CiAuthFixtureError
      ? error.message
      : "Temporary CI auth fixture initialization failed"
  );
  process.exitCode = 1;
});
