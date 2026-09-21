import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { vector } from "@electric-sql/pglite/vector";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { applyNeonMigrations } from "@/lib/db/neon-migrations";
import { createPostgrestShim } from "@/lib/db/postgrest-shim";
import { recordSkillUse } from "@/lib/skill-catalog/usage";

const owner = "00000000-0000-4000-8000-000000000701";
const stranger = "00000000-0000-4000-8000-000000000702";
const deploySkill = "00000000-0000-4000-8000-000000000710";
const notesSkill = "00000000-0000-4000-8000-000000000711";
const strangerSkill = "00000000-0000-4000-8000-000000000712";

let db: PGlite;
type Client = NonNullable<Parameters<typeof recordSkillUse>[2]>;
let client: Client;

async function counts() {
  const { rows } = await db.query<{ id: string; usage_count: number | null }>(
    "select id, usage_count from skills order by id"
  );
  return Object.fromEntries(rows.map((row) => [row.id, row.usage_count]));
}

describe("skill usage counting against the migrated schema", () => {
  beforeAll(async () => {
    db = await PGlite.create({
      extensions: { vector, pg_trgm, pgcrypto, uuid_ossp },
    });
    expect(
      (await applyNeonMigrations(db, { log: () => {}, warn: () => {} })).ok
    ).toBe(true);
    await db.query("insert into profiles(id) values ($1),($2)", [
      owner,
      stranger,
    ]);
    await db.query(
      `insert into skills(id,user_id,name,content,usage_count) values
        ($1,$4,'Deploy checklist','a',0),
        ($2,$4,'Release notes','b',null),
        ($3,$5,'Private','c',7)`,
      [deploySkill, notesSkill, strangerSkill, owner, stranger]
    );
    client = createPostgrestShim({
      query: async (sql, values) => ({
        rows: (await db.query<Record<string, unknown>>(sql, values ?? [])).rows,
      }),
    }) as unknown as Client;
  });

  afterAll(async () => {
    await db.close();
  });

  it("should count each of the caller's skills once per call, starting a null counter at one", async () => {
    await recordSkillUse(
      owner,
      [
        { id: deploySkill, source: "library" },
        { id: deploySkill, source: "library" },
        { id: notesSkill, source: "library" },
      ],
      client
    );
    expect(await counts()).toEqual({
      [deploySkill]: 1,
      [notesSkill]: 1,
      [strangerSkill]: 7,
    });
  });

  it("should never count against someone else's skill, whatever id is passed", async () => {
    await recordSkillUse(
      owner,
      [{ id: strangerSkill, source: "library" }],
      client
    );
    expect((await counts())[strangerSkill]).toBe(7);
  });

  it("should skip repo-defined skills, which carry no counter", async () => {
    await recordSkillUse(owner, [{ id: deploySkill, source: "repo" }], client);
    expect((await counts())[deploySkill]).toBe(1);
  });

  it("should not lose increments when runs finish together", async () => {
    await Promise.all(
      Array.from({ length: 5 }, () =>
        recordSkillUse(owner, [{ id: deploySkill, source: "library" }], client)
      )
    );
    expect((await counts())[deploySkill]).toBe(6);
  });

  it("should swallow a database failure rather than fail the run", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const broken = {
      rpc: async () => ({ data: null, error: { message: "offline" } }),
    } as unknown as Client;
    await expect(
      recordSkillUse(owner, [{ id: deploySkill, source: "library" }], broken)
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
