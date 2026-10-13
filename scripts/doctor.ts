// Checks a self-hosted deployment's configuration and reports what is missing.
//
// Usage: pnpm setup:doctor [--live]
//   --live  also calls Trigger.dev and Vercel to validate credentials
// Reads the environment plus .env and .env.local. Exits 1 when a check fails.
import path from "node:path";
import { Client } from "pg";
import { listNeonMigrationVersions } from "../lib/setup-doctor/database-check";
import {
  formatDoctorTable,
  hasFailures,
  runSetupDoctor,
} from "../lib/setup-doctor/run";
import { loadLocalEnvFiles } from "../lib/trigger/load-local-env";

async function main() {
  loadLocalEnvFiles(process.cwd(), process.env);
  const results = await runSetupDoctor(
    process.env,
    {
      database: {
        withConnection: async (url, run) => {
          const client = new Client({
            connectionString: url,
            connectionTimeoutMillis: 10_000,
          });
          await client.connect();
          try {
            return await run(async (sql) => (await client.query(sql)).rows);
          } finally {
            await client.end();
          }
        },
        listMigrationVersions: () =>
          listNeonMigrationVersions(
            path.join(process.cwd(), "neon", "migrations")
          ),
      },
      fetch: (url, init) => fetch(url, init),
    },
    { live: process.argv.includes("--live") }
  );
  console.log(formatDoctorTable(results));
  if (hasFailures(results)) process.exitCode = 1;
}

// Top-level await is unavailable under the repo tsconfig's module setting.
// eslint-disable-next-line unicorn/prefer-top-level-await
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
