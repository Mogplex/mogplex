// Turns a schema-only pg_dump on stdin into neon/baseline.sql. The dump must
// come from a database with every file in neon/migrations/ applied; the
// header records the latest migration version so the runner can seed the
// ledger. Exact pg_dump flags are in neon/README.md.
//
// Usage: pg_dump "$DATABASE_URL" <flags> | pnpm exec tsx scripts/build-neon-baseline.ts
import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { text } from "node:stream/consumers";
import {
  buildNeonBaselineSql,
  latestMigrationVersion,
} from "../lib/db/neon-baseline";

async function main() {
  const migrationsDir = path.join(process.cwd(), "neon", "migrations");
  const baselinePath = path.join(process.cwd(), "neon", "baseline.sql");

  const through = latestMigrationVersion(await readdir(migrationsDir));
  if (!through) {
    console.error(`no migrations found in ${migrationsDir}`);
    process.exitCode = 1;
    return;
  }

  const rawDump = await text(process.stdin);
  const baseline = buildNeonBaselineSql(rawDump, through);
  await writeFile(baselinePath, baseline);
  console.log(
    `wrote ${path.relative(process.cwd(), baselinePath)} through ${through} (${baseline.split("\n").length} lines)`
  );
}

// Top-level await is unavailable under the repo tsconfig's module setting.
// eslint-disable-next-line unicorn/prefer-top-level-await
main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
