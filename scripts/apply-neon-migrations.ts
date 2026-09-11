// Applies neon/migrations/*.sql against DATABASE_URL. An empty database is
// first bootstrapped from neon/baseline.sql. See lib/db/neon-migrations.ts.
//
// Usage: pnpm exec tsx --env-file=.env.local scripts/apply-neon-migrations.ts [--dry-run]
import { Client } from "pg";
import { applyNeonMigrations } from "../lib/db/neon-migrations";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const connectionString =
    process.env.DATABASE_URL || process.env.mogplex_DATABASE_URL;
  if (!connectionString) {
    console.error(
      "DATABASE_URL is not set (load it with `tsx --env-file=.env.local` or export it)"
    );
    process.exitCode = 1;
    return;
  }

  const client = new Client({ connectionString });
  await client.connect();
  try {
    const result = await applyNeonMigrations(
      {
        query: (sql, params) => client.query(sql, params),
        exec: (sql) => client.query(sql),
      },
      { dryRun }
    );
    if (!result.ok) process.exitCode = 1;
  } finally {
    await client.end();
  }
}

// Top-level await is unavailable under the repo tsconfig's module setting.
// eslint-disable-next-line unicorn/prefer-top-level-await
main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
