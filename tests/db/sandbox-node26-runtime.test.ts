import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { vector } from "@electric-sql/pglite/vector";
import { afterAll, beforeAll, expect, it } from "vitest";
import { applyNeonMigrations } from "@/lib/db/neon-migrations";

let db: PGlite;
const owner = "00000000-0000-4000-8000-000000000001";
beforeAll(async () => {
  db = await PGlite.create({
    extensions: { vector, pg_trgm, pgcrypto, uuid_ossp },
  });
  expect(
    (await applyNeonMigrations(db, { log: () => {}, warn: () => {} })).ok
  ).toBe(true);
  await db.query("insert into profiles(id) values ($1)", [owner]);
  await db.query(
    "insert into workspaces(id,user_id,owner_user_id,name) values ($1,$1,$1,'Runtime fixture')",
    [owner]
  );
}, 120_000);
afterAll(async () => {
  await db.close();
});

it.each(["node22", "node24", "node26", "python3.13", null])(
  "persists repository settings and sandbox launches with runtime %s",
  async (runtime) => {
    const {
      rows: [repo],
    } = await db.query<{ id: string }>(
      "insert into repos(user_id,owner_user_id,workspace_id,full_name,owner,name,runtime) values ($1,$1,$1,$2,'fixture',$2,$3) returning id",
      [owner, `fixture/${runtime ?? "auto"}`, runtime]
    );
    const {
      rows: [sandbox],
    } = await db.query<{ runtime: string | null }>(
      "insert into sandboxes(user_id,repo_id,sandbox_id,runtime) values ($1,$2,$3,$4) returning runtime",
      [owner, repo.id, `runtime-${runtime ?? "auto"}`, runtime]
    );
    expect(sandbox.runtime).toBe(runtime);
    expect(
      (
        await db.query<{ runtime: string | null }>(
          "select runtime from repos where id=$1",
          [repo.id]
        )
      ).rows[0].runtime
    ).toBe(runtime);
  }
);

it("still rejects unknown runtime values", async () => {
  await expect(
    db.query(
      "insert into repos(user_id,owner_user_id,workspace_id,full_name,owner,name,runtime) values ($1,$1,$1,'fixture/invalid','fixture','invalid','node999')",
      [owner]
    )
  ).rejects.toThrow(/repos_runtime_check/);
  await expect(
    db.query(
      "insert into sandboxes(user_id,repo_id,sandbox_id,runtime) values ($1,(select id from repos limit 1),'invalid-runtime','node999')",
      [owner]
    )
  ).rejects.toThrow(/sandboxes_runtime_check/);
});
