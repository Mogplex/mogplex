import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { vector } from "@electric-sql/pglite/vector";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyNeonMigrations } from "@/lib/db/neon-migrations";
import { SHIM_TYPE_PARSERS } from "@/lib/db/pool";

const owner = "00000000-0000-4000-8000-000000000170";
let db: PGlite;

async function insertFlow(sourceKind: string) {
  return db.query(
    `insert into flows(user_id, installation_id, name, source_kind)
     values ($1, 1, $2, $2)`,
    [owner, sourceKind]
  );
}

describe("flows.source_kind against the migrated schema", () => {
  beforeAll(async () => {
    db = await PGlite.create({
      extensions: { vector, pg_trgm, pgcrypto, uuid_ossp },
      parsers: SHIM_TYPE_PARSERS,
    });
    expect(
      (await applyNeonMigrations(db, { log: () => {}, warn: () => {} })).ok
    ).toBe(true);
    await db.query("insert into profiles(id) values ($1)", [owner]);
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("should accept api automations", async () => {
    await expect(insertFlow("api")).resolves.toBeDefined();
  });

  it("should keep accepting every kind an earlier release writes", async () => {
    for (const kind of ["github", "schedule", "webhook", "slack"]) {
      await expect(insertFlow(kind)).resolves.toBeDefined();
    }
  });

  it("should still reject an unknown kind", async () => {
    await expect(insertFlow("direct")).rejects.toThrow(
      /flows_source_kind_check/
    );
  });
});
