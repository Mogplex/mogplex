import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { vector } from "@electric-sql/pglite/vector";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { applyNeonMigrations } from "@/lib/db/neon-migrations";
import { createPostgrestShim } from "@/lib/db/postgrest-shim";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  resolveSandboxGitAuthor,
  FALLBACK_SANDBOX_GIT_AUTHOR,
} from "@/lib/sandbox/git-author";

const owner = "00000000-0000-4000-8000-000000000031";
let db: PGlite;
const previousFrom = Object.getOwnPropertyDescriptor(supabaseAdmin, "from");

beforeAll(async () => {
  db = await PGlite.create({
    extensions: { vector, pg_trgm, pgcrypto, uuid_ossp },
    parsers: { 20: (value) => value },
  });
  expect(
    (await applyNeonMigrations(db, { log: () => {}, warn: () => {} })).ok
  ).toBe(true);
  await db.query(
    "insert into profiles(id, github_username, github_user_id, name) values ($1, 'octocat', 123, 'GitHub User')",
    [owner]
  );
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
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new Error("GitHub unavailable"))
  );
}, 120_000);

afterAll(async () => {
  if (previousFrom) Object.defineProperty(supabaseAdmin, "from", previousFrom);
  else Reflect.deleteProperty(supabaseAdmin, "from");
  vi.unstubAllGlobals();
  await db.close();
});

it("resolves the stored GitHub identity when bigint IDs are strings and GitHub is unavailable", async () => {
  const profile = await supabaseAdmin
    .from("profiles")
    .select("github_user_id")
    .eq("id", owner)
    .single();
  expect(profile.data?.github_user_id).toBe("123");
  expect(await resolveSandboxGitAuthor(owner)).toEqual({
    name: "GitHub User",
    email: "123+octocat@users.noreply.github.com",
  });
  expect(fetch).not.toHaveBeenCalled();
});

it("does not borrow another user's identity when the profile is missing", async () => {
  expect(
    await resolveSandboxGitAuthor("00000000-0000-4000-8000-000000000032")
  ).toEqual(FALLBACK_SANDBOX_GIT_AUTHOR);
});
