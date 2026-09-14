import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { realpathSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { vector } from "@electric-sql/pglite/vector";
import { applyNeonMigrations } from "@/lib/db/neon-migrations";
import { SHIM_TYPE_PARSERS } from "@/lib/db/pool";
import { checkSchemaCompatibility } from "./schema-compatibility-contract";

async function main() {
  const phase = process.argv[2];
  assert.ok(
    phase === "seed" || phase === "migrate" || phase === "verify",
    "Unknown compatibility phase"
  );
  const dataDir = process.argv[3];
  assert.ok(dataDir, "An isolated database directory is required");
  const root = realpathSync(process.cwd());
  const source = realpathSync(
    createRequire(import.meta.url).resolve("@/lib/production-smoke")
  );
  assert.ok(
    source.startsWith(`${root}${path.sep}`),
    "Compatibility imports must resolve inside the selected release"
  );
  console.log(JSON.stringify({ phase, source }));
  const db = await PGlite.create({
    dataDir,
    extensions: { vector, pg_trgm, pgcrypto, uuid_ossp },
    parsers: SHIM_TYPE_PARSERS,
  });
  try {
    if (phase !== "verify") {
      const result = await applyNeonMigrations(db);
      assert.equal(result.ok, true, JSON.stringify(result));
    }
    if (phase !== "migrate") {
      await checkSchemaCompatibility(
        {
          query: async (sql, values) => ({
            rows: (await db.query<Record<string, unknown>>(sql, values ?? []))
              .rows,
          }),
        },
        phase
      );
    }
  } finally {
    await db.close();
  }
}
// tsx runs this .ts harness as CommonJS in archived releases.
// eslint-disable-next-line unicorn/prefer-top-level-await
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
