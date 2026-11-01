import { generateKeyPairSync } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { vector } from "@electric-sql/pglite/vector";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { applyNeonMigrations } from "@/lib/db/neon-migrations";
import { createPostgrestShim } from "@/lib/db/postgrest-shim";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { listUserGithubInstallations } from "@/lib/github-user-installations";
import { isGithubOAuthRepositoryAccessAllowed } from "@/lib/github-repository-auth";
import { getGithubAccessTokenForRepo } from "@/lib/github-access";
import { syncGithubReposForUser } from "@/lib/github-sync";

let db: PGlite;
const previousFrom = Object.getOwnPropertyDescriptor(supabaseAdmin, "from");
beforeAll(async () => {
  db = await PGlite.create({
    extensions: { vector, pg_trgm, pgcrypto, uuid_ossp },
  });
  expect(
    (await applyNeonMigrations(db, { log: () => {}, warn: () => {} })).ok
  ).toBe(true);
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
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
afterAll(async () => {
  if (previousFrom) Object.defineProperty(supabaseAdmin, "from", previousFrom);
  else Reflect.deleteProperty(supabaseAdmin, "from");
  await db?.close();
});
it("keeps every attached grant user-scoped and never treats an App profile as OAuth repository authorization", async () => {
  const owner = "00000000-0000-4000-8000-000000000071";
  const other = "00000000-0000-4000-8000-000000000072";
  await db.query(
    "insert into profiles(id,github_auth_mode) values ($1,'app'),($2,'oauth')",
    [owner, other]
  );
  for (let index = 1; index <= 7; index++)
    await db.query(
      "insert into github_installations(user_id,installation_id,account_login,account_type) values ($1,$2,$3,'Organization')",
      [owner, 1000 + index, index === 7 ? null : `approved-${index}`]
    );
  await db.query(
    "insert into github_installations(user_id,installation_id,account_login,account_type) values ($1,2001,'not-approved','Organization')",
    [other]
  );
  const grants = await listUserGithubInstallations(owner, {
    getInstallation: async (id) => ({
      id,
      account: { login: "approved-7", type: "Organization" },
    }),
  });
  expect(
    grants
      .map((grant) => grant.account_login)
      .sort((a, b) => (a ?? "").localeCompare(b ?? ""))
  ).toEqual(Array.from({ length: 7 }, (_, index) => `approved-${index + 1}`));
  expect(
    await listUserGithubInstallations("00000000-0000-4000-8000-000000000073")
  ).toEqual([]);
  vi.stubEnv("GITHUB_APP_ID", "");
  vi.stubEnv("GITHUB_APP_NAME", "");
  vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "");
  expect(await isGithubOAuthRepositoryAccessAllowed(owner)).toBe(false);
  expect(await isGithubOAuthRepositoryAccessAllowed(other)).toBe(true);
  vi.stubEnv("GITHUB_APP_ID", "1");
  vi.stubEnv("GITHUB_APP_NAME", "mogplex-test");
  vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "configured");
  expect(await isGithubOAuthRepositoryAccessAllowed(other)).toBe(false);
});

it("uses the current App repository grant and retains disconnected stored work without exposing it as authorized", async () => {
  const owner = "00000000-0000-4000-8000-000000000081";
  const withoutGrant = "00000000-0000-4000-8000-000000000082";
  const workspace = "00000000-0000-4000-8000-000000000083";
  const otherWorkspace = "00000000-0000-4000-8000-000000000084";
  await db.query(
    "insert into profiles(id,github_auth_mode) values ($1,'app'),($2,'app')",
    [owner, withoutGrant]
  );
  await db.query(
    "insert into github_installations(user_id,installation_id,account_login,account_type) values ($1,5001,'approved','Organization')",
    [owner]
  );
  await db.query(
    "insert into workspaces(id,user_id,owner_user_id,name,is_default) values ($1,$2,$2,'Imported',true),($3,$4,$4,'Imported',true)",
    [workspace, owner, otherWorkspace, withoutGrant]
  );
  await db.query(
    "insert into repos(user_id,owner_type,owner_user_id,github_id,github_installation_id,full_name,workspace_id,is_hidden) values ($1,'user',$1,51,5001,'approved/app',$2,false),($1,'user',$1,52,5001,'unapproved/transferred',$2,false),($1,'user',$1,53,null,'unapproved/oauth-only',$2,false),($3,'user',$3,54,null,'unapproved/no-installation',$4,false)",
    [owner, workspace, withoutGrant, otherWorkspace]
  );
  vi.stubEnv("GITHUB_APP_ID", "1");
  vi.stubEnv("GITHUB_APP_NAME", "fixture");
  vi.stubEnv(
    "GITHUB_APP_PRIVATE_KEY",
    generateKeyPairSync("rsa", { modulusLength: 2048 })
      .privateKey.export({ type: "pkcs8", format: "pem" })
      .toString()
  );
  const paths: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    const path = new URL(url).pathname;
    paths.push(path);
    if (path === "/app/installations/5001/access_tokens")
      return Response.json({ token: "ghs-fixture" });
    if (path === "/installation/repositories")
      return Response.json({
        total_count: 1,
        repositories: [
          {
            id: 51,
            full_name: "approved/app",
            name: "app",
            owner: { login: "approved" },
          },
        ],
      });
    throw new Error(`Unexpected provider request: ${path}`);
  });
  const visible = await syncGithubReposForUser(owner, "older-oauth-fixture");
  expect(visible.map((repo) => repo.full_name)).toEqual(["approved/app"]);
  expect(
    await syncGithubReposForUser(withoutGrant, "older-oauth-fixture")
  ).toEqual([]);
  expect(paths).not.toContain("/user/repos");
  expect(
    (
      await db.query(
        "select count(*)::int as count from repos where user_id=$1",
        [owner]
      )
    ).rows
  ).toEqual([{ count: 3 }]);
  expect(
    await getGithubAccessTokenForRepo({
      user_id: withoutGrant,
      github_installation_id: 5001,
    })
  ).toBeNull();
  expect(
    await getGithubAccessTokenForRepo({
      user_id: owner,
      github_installation_id: 5001,
    })
  ).toBe("ghs-fixture");
});
