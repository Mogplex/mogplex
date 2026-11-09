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
import { reconcileGithubInstallationsForUser } from "@/lib/github-installations";
import { syncGithubWebhookState } from "@/lib/github-webhook-sync";

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

function stubGithubApp() {
  vi.stubEnv("GITHUB_APP_ID", "1");
  vi.stubEnv("GITHUB_APP_NAME", "fixture");
  vi.stubEnv(
    "GITHUB_APP_PRIVATE_KEY",
    generateKeyPairSync("rsa", { modulusLength: 2048 })
      .privateKey.export({ type: "pkcs8", format: "pem" })
      .toString()
  );
}

async function installationCount(userId: string) {
  return (
    await db.query<{ count: number }>(
      "select count(*)::int as count from github_installations where user_id=$1",
      [userId]
    )
  ).rows[0]?.count;
}

it("should attach org installations only for orgs GitHub confirms the user belongs to", async () => {
  const member = "00000000-0000-4000-8000-0000000000a1";
  await db.query(
    "insert into profiles(id,github_username) values ($1,'org-member')",
    [member]
  );
  stubGithubApp();
  const requests: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    const path = new URL(url).pathname;
    requests.push(path);
    if (path === "/user/orgs")
      return Response.json([{ login: "member-org" }, { login: "former-org" }]);
    if (path === "/orgs/member-org/installation")
      return Response.json({
        id: 6001,
        account: { login: "member-org", type: "Organization" },
      });
    if (path === "/orgs/former-org/installation")
      return Response.json({
        id: 6002,
        account: { login: "former-org", type: "Organization" },
      });
    if (path.endsWith("/access_tokens"))
      return Response.json({ token: "ghs-fixture" });
    if (path === "/orgs/member-org/members/org-member")
      return new Response(null, { status: 204 });
    if (path === "/installation/repositories")
      return Response.json({ repositories: [] });
    return new Response(null, { status: 404 });
  });
  expect(
    await reconcileGithubInstallationsForUser(
      member,
      "org-member",
      "identity-fixture"
    )
  ).toEqual({ discovered: 1 });
  expect(
    (
      await db.query(
        "select installation_id from github_installations where user_id=$1",
        [member]
      )
    ).rows
  ).toEqual([{ installation_id: 6001 }]);
  expect(requests).toContain("/orgs/former-org/members/org-member");

  requests.length = 0;
  expect(
    await reconcileGithubInstallationsForUser(
      member,
      "org-member",
      "identity-fixture"
    )
  ).toEqual({ discovered: 0 });
  expect(requests).not.toContain("/orgs/member-org/installation");
});

it("should attach a new installation to the Mogplex user who installed it on GitHub", async () => {
  const installer = "00000000-0000-4000-8000-0000000000a2";
  const bystander = "00000000-0000-4000-8000-0000000000a3";
  await db.query(
    "insert into profiles(id,github_username,github_user_id) values ($1,'installer',4242),($2,'bystander',4343)",
    [installer, bystander]
  );
  stubGithubApp();
  vi.stubGlobal("fetch", async (url: string) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/access_tokens"))
      return Response.json({ token: "ghs-fixture" });
    if (path === "/installation/repositories")
      return Response.json({ repositories: [] });
    return new Response(null, { status: 404 });
  });
  const outcome = await syncGithubWebhookState("installation", {
    action: "created",
    sender: { login: "renamed-installer", id: 4242 },
    installation: {
      id: 7001,
      account: { login: "new-org", type: "Organization" },
    },
  });
  expect(outcome.matchedUsers).toBe(1);
  expect(await installationCount(installer)).toBe(1);
  expect(await installationCount(bystander)).toBe(0);

  const deleted = await syncGithubWebhookState("installation", {
    action: "deleted",
    sender: { login: "bystander", id: 4343 },
    installation: {
      id: 7002,
      account: { login: "other-org", type: "Organization" },
    },
  });
  expect(deleted.matchedUsers).toBe(0);
  expect(await installationCount(bystander)).toBe(0);
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
  expect(await reconcileGithubInstallationsForUser(owner)).toEqual({
    discovered: 0,
  });
  expect(
    await reconcileGithubInstallationsForUser(
      "00000000-0000-4000-8000-000000000073"
    )
  ).toEqual({ discovered: 0 });
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
      await syncGithubWebhookState("installation_repositories", {
        action: "added",
        installation: {
          id: 5001,
          account: { login: "approved", type: "Organization" },
        },
        sender: { login: "another-sender" },
        repositories_added: [],
        repositories_removed: [],
      })
    ).matchedUsers
  ).toBe(1);
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

it("preserves shared team repositories through each owner's current grant for members with different or no installations", async () => {
  const owner = "00000000-0000-4000-8000-000000000091";
  const member = "00000000-0000-4000-8000-000000000092";
  const withoutGrant = "00000000-0000-4000-8000-000000000093";
  const team = "00000000-0000-4000-8000-000000000094";
  const workspace = "00000000-0000-4000-8000-000000000095";
  await db.query(
    "insert into profiles(id,github_auth_mode) values ($1,'app'),($2,'app'),($3,'app')",
    [owner, member, withoutGrant]
  );
  await db.query(
    "insert into teams(id,name,slug,owner_user_id) values ($1,'Shared','github-shared-fixture',$2)",
    [team, owner]
  );
  await db.query(
    "insert into team_members(team_id,user_id,role) values ($1,$2,'developer'),($1,$3,'developer')",
    [team, member, withoutGrant]
  );
  await db.query(
    "insert into github_installations(user_id,installation_id,account_login,account_type) values ($1,6001,'approved-a','Organization'),($2,6002,'approved-b','Organization')",
    [owner, member]
  );
  await db.query(
    "insert into workspaces(id,user_id,owner_type,owner_user_id,product_team_id,name,is_default) values ($1,$2,'team',null,$3,'Shared',true)",
    [workspace, owner, team]
  );
  await db.query(
    "insert into repos(user_id,owner_type,owner_user_id,product_team_id,github_id,github_installation_id,full_name,workspace_id,is_hidden) values ($1,'team',null,$3,71,6001,'approved-a/app',$4,false),($2,'team',null,$3,72,6002,'approved-b/app',$4,false),($1,'team',null,$3,73,6001,'unapproved/transferred-team',$4,false),($1,'team',null,$3,75,null,'unapproved/oauth-team',$4,false),($1,'team',null,$3,76,6002,'unapproved/foreign-installation',$4,false)",
    [owner, member, team, workspace]
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
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    paths.push(path);
    const installation = path.match(
      /^\/app\/installations\/(600[12])\/access_tokens$/
    )?.[1];
    if (installation) return Response.json({ token: `ghs-${installation}` });
    if (path === "/installation/repositories") {
      const token = new Headers(init?.headers).get("Authorization");
      const first = token === "Bearer ghs-6001";
      expect(["Bearer ghs-6001", "Bearer ghs-6002"]).toContain(token);
      return Response.json({
        repositories: [
          {
            id: first ? 71 : 72,
            full_name: `approved-${first ? "a" : "b"}/app`,
            name: "app",
            owner: { login: `approved-${first ? "a" : "b"}` },
          },
          ...(first
            ? [
                {
                  id: 77,
                  full_name: "approved-a/unshared",
                  name: "unshared",
                  owner: { login: "approved-a" },
                },
              ]
            : []),
        ],
      });
    }
    throw new Error(`Unexpected provider request: ${path}`);
  });
  for (const actor of [member, withoutGrant]) {
    const visible = await syncGithubReposForUser(actor, "older-oauth-fixture", {
      productTeamId: team,
    });
    expect(
      visible.map((repo) => repo.full_name).sort((a, b) => a.localeCompare(b))
    ).toEqual(["approved-a/app", "approved-b/app"]);
  }
  expect(paths).not.toContain("/user/repos");
  expect(
    (
      await db.query(
        "select count(*)::int as count from repos where product_team_id=$1",
        [team]
      )
    ).rows
  ).toEqual([{ count: 5 }]);
});
