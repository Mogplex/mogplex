import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { vector } from "@electric-sql/pglite/vector";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  createReposPatchHandler,
  createReposPostHandler,
} from "@/app/api/repos/route";
import { applyNeonMigrations } from "@/lib/db/neon-migrations";
import { createPostgrestShim } from "@/lib/db/postgrest-shim";
import { supabaseAdmin } from "@/lib/supabase/admin";

const owner = "00000000-0000-4000-8000-000000000021";
const stranger = "00000000-0000-4000-8000-000000000022";
let db: PGlite;
const previousFrom = Object.getOwnPropertyDescriptor(supabaseAdmin, "from");

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
  const shim = createPostgrestShim({
    query: async (text, values) => {
      const result = await db.query(text, values);
      return { rows: result.rows as Record<string, unknown>[] };
    },
  });
  Object.defineProperty(supabaseAdmin, "from", {
    configurable: true,
    value: shim.from.bind(shim),
  });
}, 120_000);

afterAll(async () => {
  if (previousFrom) Object.defineProperty(supabaseAdmin, "from", previousFrom);
  else Reflect.deleteProperty(supabaseAdmin, "from");
  await db.close();
});

it("creates, hides, and restores a personal repository with its workspace through the real route", async () => {
  const deps = {
    requireUserId: async () => owner,
    hasGithubAppConfig: () => false,
  };
  const post = createReposPostHandler(deps);
  const patch = createReposPatchHandler(deps);
  const request = (body: object, method = "PATCH") =>
    new Request("https://mogplex.test/api/repos", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const created = await post(
    request(
      {
        github_id: 42,
        full_name: "alex/widget",
        owner: "alex",
        name: "widget",
      },
      "POST"
    )
  );
  expect(created.status).toBe(200);
  const repo = await created.json();
  expect(repo).toMatchObject({
    full_name: "alex/widget",
    owner_type: "user",
    product_team_id: null,
    workspace: {
      owner_type: "user",
      owner_user_id: owner,
      product_team_id: null,
      is_default: true,
    },
  });
  for (const isHidden of [true, false]) {
    const response = await patch(request({ id: repo.id, is_hidden: isHidden }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: repo.id,
      is_hidden: isHidden,
      workspace: { id: repo.workspace.id },
    });
    expect(
      (await db.query("select is_hidden from repos where id=$1", [repo.id]))
        .rows
    ).toEqual([{ is_hidden: isHidden }]);
  }
  const forbidden = await createReposPatchHandler({
    ...deps,
    requireUserId: async () => stranger,
  })(request({ id: repo.id, is_hidden: true }));
  expect(forbidden.ok).toBe(false);
  expect(
    (await db.query("select is_hidden from repos where id=$1", [repo.id])).rows
  ).toEqual([{ is_hidden: false }]);
});
