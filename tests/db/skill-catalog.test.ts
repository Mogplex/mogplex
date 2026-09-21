import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { vector } from "@electric-sql/pglite/vector";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyNeonMigrations } from "@/lib/db/neon-migrations";
import { createPostgrestShim } from "@/lib/db/postgrest-shim";
import { loadSkillCatalog } from "@/lib/skill-catalog/store";

const owner = "00000000-0000-4000-8000-000000000301";
const stranger = "00000000-0000-4000-8000-000000000302";
const repo = "00000000-0000-4000-8000-000000000310";
const otherRepo = "00000000-0000-4000-8000-000000000311";
const deploySkill = "00000000-0000-4000-8000-000000000320";
const notesSkill = "00000000-0000-4000-8000-000000000321";
const newerNotesSkill = "00000000-0000-4000-8000-000000000322";
const strangerSkill = "00000000-0000-4000-8000-000000000323";

let db: PGlite;
type Client = Parameters<typeof loadSkillCatalog>[1];
let client: Client;

function summary(catalog: Awaited<ReturnType<typeof loadSkillCatalog>>) {
  return catalog.skills.map((skill) => `${skill.source}:${skill.slug}`);
}

describe("skill catalog against the migrated schema", () => {
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
      "insert into workspaces(id,user_id,owner_user_id,name) values ($1,$2,$2,'Widgets'),($3,$2,$2,'Gadgets')",
      [repo, owner, otherRepo]
    );
    await db.query(
      `insert into repos(id,user_id,owner_user_id,workspace_id,full_name,owner,name) values
        ($1,$2,$2,$1,'acme/widgets','acme','widgets'),
        ($3,$2,$2,$3,'acme/gadgets','acme','gadgets')`,
      [repo, owner, otherRepo]
    );
    await db.query(
      `insert into skills(id,user_id,name,description,content,tags,created_at) values
        ($1,$5,'Deploy checklist','Before shipping','1. Run the tests.','{release}','2026-01-01'),
        ($2,$5,'Release notes',null,'Group changes by area.','{}','2026-01-02'),
        ($3,$5,'Release Notes!',null,'Newer take.','{}','2026-01-03'),
        ($4,$6,'Private','Someone else','secret','{}','2026-01-01')`,
      [deploySkill, notesSkill, newerNotesSkill, strangerSkill, owner, stranger]
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

  it("should list only the acting user's library, oldest skill keeping the plain slug", async () => {
    const catalog = await loadSkillCatalog({ userId: owner }, client);
    expect(summary(catalog)).toEqual([
      "library:deploy-checklist",
      "library:release-notes",
      "library:release-notes-2",
    ]);
    expect(catalog.skills[0]).toMatchObject({
      id: deploySkill,
      description: "Before shipping",
      content: "1. Run the tests.",
      tags: ["release"],
    });
    expect(
      summary(await loadSkillCatalog({ userId: stranger }, client))
    ).toEqual(["library:private"]);
  });

  it("should let a repo exclude a library skill through the route's upsert, idempotently", async () => {
    for (const excluded of [true, true]) {
      const { error } = await client!
        .from("repo_skill_overrides")
        .upsert(
          { repo_id: repo, skill_id: deploySkill, excluded },
          { onConflict: "repo_id,skill_id" }
        );
      expect(error).toBeNull();
    }
    const { rows } = await db.query(
      "select id from repo_skill_overrides where repo_id = $1",
      [repo]
    );
    expect(rows).toHaveLength(1);

    expect(
      summary(await loadSkillCatalog({ userId: owner, repoId: repo }, client))
    ).toEqual(["library:release-notes", "library:release-notes-2"]);
    // Another repo, and a run with no repo, still see the whole library.
    expect(
      summary(
        await loadSkillCatalog({ userId: owner, repoId: otherRepo }, client)
      )
    ).toHaveLength(3);
    expect(
      summary(await loadSkillCatalog({ userId: owner }, client))
    ).toHaveLength(3);
  });

  it("should bring a skill back when the repo stops excluding it", async () => {
    const { error } = await client!
      .from("repo_skill_overrides")
      .upsert(
        { repo_id: repo, skill_id: deploySkill, excluded: false },
        { onConflict: "repo_id,skill_id" }
      );
    expect(error).toBeNull();
    expect(
      summary(await loadSkillCatalog({ userId: owner, repoId: repo }, client))
    ).toContain("library:deploy-checklist");
  });

  it("should put a repo's own skills first so they take the plain slug", async () => {
    await db.query(
      // Rows written in one statement share now(); the catalog orders by
      // created_at, so the fixture states the order it means.
      `insert into repo_skill_overrides(repo_id,name,description,content,created_at) values
        ($1,'Release notes','Repo flavour','Use the widgets template.','2026-02-01'),
        ($1,'Seed data',null,'','2026-02-02')`,
      [repo]
    );
    const catalog = await loadSkillCatalog(
      { userId: owner, repoId: repo },
      client
    );
    expect(summary(catalog)).toEqual([
      "repo:release-notes",
      "repo:seed-data",
      "library:deploy-checklist",
      "library:release-notes-2",
      "library:release-notes-3",
    ]);
    expect(catalog.skills[0].content).toBe("Use the widgets template.");
  });

  it("should reject a second override row for the same repo and skill", async () => {
    await expect(
      db.query(
        "insert into repo_skill_overrides(repo_id,skill_id,excluded) values ($1,$2,true)",
        [repo, deploySkill]
      )
    ).rejects.toThrow(/unique|duplicate/i);
  });
});
