import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { vector } from "@electric-sql/pglite/vector";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { applyNeonMigrations } from "@/lib/db/neon-migrations";
import { createPostgrestShim } from "@/lib/db/postgrest-shim";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { recoveryRequest } from "@/lib/slack/connection-recovery/test-fixtures";
import {
  checkGithubRecoveryAccess,
  githubRecoveryAuthorizePath,
} from "@/lib/slack/connection-recovery/github";
import {
  canRecoverConnection,
  checkConnectionRecoveryAccess,
  describeRecoveryConnector,
  recoveryAuthorizePath,
} from "@/lib/slack/connection-recovery/access";
import {
  describeConnectionScope,
  repairConnectionScope,
} from "@/lib/slack/connection-recovery/connection-scope";

let db: PGlite;
const previousFrom = Object.getOwnPropertyDescriptor(supabaseAdmin, "from");
const user = recoveryRequest().user_id;
const repo = "00000000-0000-4000-8000-000000000010";
const conn = "00000000-0000-4000-8000-000000000011";
const otherRepo = "00000000-0000-4000-8000-000000000012";
const connectionRequest = () => ({
  ...recoveryRequest(),
  repo_id: repo,
  target: { provider: "connection" as const, connectionId: conn },
});

beforeAll(async () => {
  db = await PGlite.create({
    extensions: { vector, pg_trgm, pgcrypto, uuid_ossp },
  });
  const migrations = await applyNeonMigrations(db, {
    log: () => {},
    warn: () => {},
  });
  expect(migrations.ok, JSON.stringify(migrations)).toBe(true);
  await db.query("insert into profiles(id) values ($1)", [user]);
  await db.query(
    "insert into workspaces(id,user_id,name,owner_user_id) values ($1,$2,'Imported',$2)",
    [repo, user]
  );
  await db.query(
    "insert into repos(id,user_id,owner_type,owner_user_id,full_name,is_hidden,workspace_id) values ($1,$2,'user',$2,'acme/widgets',false,$1),($3,$2,'user',$2,'acme/other',false,$1)",
    [repo, user, otherRepo]
  );
  await db.query(
    "insert into connections(id,user_id,name,type,auth_type,mcp_transport,mcp_url,scope,approval_mode) values ($1,$2,'Docs','mcp_server','none','http','https://docs.example/mcp','global','auto')",
    [conn, user]
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
}, 120_000);
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => {
  if (previousFrom) Object.defineProperty(supabaseAdmin, "from", previousFrom);
  else Reflect.deleteProperty(supabaseAdmin, "from");
  await db?.close();
});

it("checks real GitHub grants, hidden rows, ownership, and write permissions", async () => {
  const target = {
    provider: "github" as const,
    repository: "acme/widgets",
    access: "write" as const,
  };
  const deps = {
    getRepoToken: async () => "repo-token",
    getOAuthToken: async () => null,
    hasAppConfig: () => false,
  };
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    expect(url).toBe("https://api.github.com/repos/acme/widgets");
    expect(init.headers).toMatchObject({ Authorization: "Bearer repo-token" });
    return Response.json({ permissions: { push: true } });
  });
  expect(
    await checkGithubRecoveryAccess(user, target, { refresh: false }, deps)
  ).toBe(true);
  expect(
    await checkGithubRecoveryAccess(
      user,
      target,
      { refresh: false, repoId: otherRepo },
      deps
    )
  ).toBe(false);
  await db.query("update repos set is_hidden=true where id=$1", [repo]);
  expect(
    await checkGithubRecoveryAccess(user, target, { refresh: false }, deps)
  ).toBe(false);
  expect(await checkConnectionRecoveryAccess(recoveryRequest())).toMatchObject({
    ready: false,
    message: expect.stringContaining("Restore"),
  });
  expect(await describeRecoveryConnector(recoveryRequest())).toMatchObject({
    restoreRepository: true,
  });
  await db.query("update repos set is_hidden=false where id=$1", [repo]);
  vi.stubGlobal("fetch", async () =>
    Response.json({ permissions: { push: false } })
  );
  expect(
    await checkGithubRecoveryAccess(user, target, { refresh: false }, deps)
  ).toBe(false);
  expect(
    await checkGithubRecoveryAccess(
      user,
      { ...target, access: "read" },
      { refresh: false },
      deps
    )
  ).toBe(true);
  for (const status of [401, 403, 404]) {
    vi.stubGlobal("fetch", async () => Response.json({}, { status }));
    expect(
      await checkGithubRecoveryAccess(user, target, { refresh: false }, deps)
    ).toBe(false);
  }
  vi.stubGlobal("fetch", async () => Response.json({}, { status: 500 }));
  await expect(
    checkGithubRecoveryAccess(user, target, { refresh: false }, deps)
  ).rejects.toThrow("temporarily unavailable");
  expect(
    await checkGithubRecoveryAccess(
      user,
      target,
      { refresh: false },
      { ...deps, getRepoToken: async () => null }
    )
  ).toBe(false);
});

it("offers the correct owned GitHub installation and checks its current permission grant", async () => {
  const target = {
    provider: "github" as const,
    repository: "acme/widgets",
    access: "write" as const,
  };
  await db.query(
    "insert into github_installations(user_id,installation_id,account_login,account_type) values ($1,42,'acme','Organization')",
    [user]
  );
  await db.query("update repos set github_installation_id=42 where id=$1", [
    repo,
  ]);
  expect(await githubRecoveryAuthorizePath(user, target)).toBe(
    "https://github.com/organizations/acme/settings/installations/42"
  );
  expect(
    await githubRecoveryAuthorizePath(
      "00000000-0000-4000-8000-000000000099",
      target,
      "return",
      { hasAppConfig: () => true }
    )
  ).toBe("/api/auth/github?next=return");
  expect(
    await githubRecoveryAuthorizePath(
      user,
      { ...target, repository: "alex/widgets" },
      "return",
      { hasAppConfig: () => false }
    )
  ).toBe("/api/auth/github?reauthorize=1&next=return");
  vi.stubGlobal("fetch", async () =>
    Response.json({ permissions: { push: true } })
  );
  const deps = {
    getRepoToken: async () => "token",
    hasAppConfig: () => true,
    getInstallation: async () => ({
      id: 42,
      permissions: { contents: "write", pull_requests: "read" },
    }),
  };
  expect(
    await checkGithubRecoveryAccess(user, target, { refresh: false }, deps)
  ).toBe(false);
  expect(
    await checkGithubRecoveryAccess(
      user,
      target,
      { refresh: false },
      {
        ...deps,
        getInstallation: async () => ({
          id: 42,
          permissions: { contents: "write", pull_requests: "write" },
        }),
      }
    )
  ).toBe(true);
  expect(
    await checkGithubRecoveryAccess(
      user,
      { provider: "github", access: "read" },
      { refresh: false },
      deps
    )
  ).toBe(true);
  await db.query("update repos set github_installation_id=null where id=$1", [
    repo,
  ]);
  await db.exec("delete from github_installations");
});

it("does not treat an expired account OAuth token as authorized", async () => {
  const target = { provider: "github" as const, access: "read" as const };
  const deps = {
    hasAppConfig: () => false,
    getOAuthToken: async () => "expired",
  };
  vi.stubGlobal("fetch", async () => Response.json({}, { status: 401 }));
  expect(
    await checkGithubRecoveryAccess(user, target, { refresh: false }, deps)
  ).toBe(false);
  expect(
    await checkGithubRecoveryAccess(
      user,
      target,
      { refresh: false },
      { ...deps, getOAuthToken: async () => null }
    )
  ).toBe(false);
  vi.stubGlobal("fetch", async () => Response.json({ login: "alex" }));
  expect(
    await checkGithubRecoveryAccess(user, target, { refresh: false }, deps)
  ).toBe(true);
});

it("repairs disabled/excluded and project scopes only for the requester without changing tool approval", async () => {
  const request = connectionRequest();
  expect(await describeConnectionScope(request)).toBeUndefined();
  await db.query("update connections set is_enabled=false where id=$1", [conn]);
  await db.query(
    "insert into repo_connection_overrides(repo_id,connection_id,excluded) values ($1,$2,true)",
    [repo, conn]
  );
  expect(await describeConnectionScope(request)).toMatchObject({
    label: "Use for this repository",
    explanation: expect.stringContaining("acme/widgets"),
  });
  expect(await checkConnectionRecoveryAccess(request)).toMatchObject({
    ready: false,
    message: expect.stringContaining("disabled"),
  });
  await repairConnectionScope(request);
  expect(await describeConnectionScope(request)).toBeUndefined();
  expect(
    (
      await db.query("select approval_mode from connections where id=$1", [
        conn,
      ])
    ).rows
  ).toEqual([{ approval_mode: "auto" }]);
  await db.query(
    "update connections set scope='project',repo_id=$1,approval_mode='ask' where id=$2",
    [otherRepo, conn]
  );
  expect(await checkConnectionRecoveryAccess(request)).toMatchObject({
    ready: false,
    message: expect.stringContaining("scope"),
  });
  expect(await describeConnectionScope(request)).toMatchObject({
    explanation: expect.stringContaining(
      "no longer be available in its previous project"
    ),
  });
  await repairConnectionScope(request);
  expect(await checkConnectionRecoveryAccess(request)).toMatchObject({
    ready: false,
    message: expect.stringContaining("approval for each tool call"),
  });
  await expect(
    repairConnectionScope({
      ...request,
      user_id: "00000000-0000-4000-8000-000000000099",
    })
  ).rejects.toThrow("no longer available");
  expect(
    await describeConnectionScope({
      ...request,
      repo_id: "00000000-0000-4000-8000-000000000099",
    })
  ).toBeUndefined();
  expect(
    await canRecoverConnection(
      user,
      "00000000-0000-4000-8000-000000000099",
      "connection"
    )
  ).toBe(false);
  await db.query("update connections set is_enabled=false where id=$1", [conn]);
  expect(
    await describeConnectionScope({ ...request, repo_id: null })
  ).toMatchObject({ label: "Enable connection" });
  await repairConnectionScope({ ...request, repo_id: null });
});

it("checks connection readiness and uses owned OAuth return paths without exposing credentials", async () => {
  const request = connectionRequest();
  expect(
    await recoveryAuthorizePath({ ...request, target: { provider: "vercel" } })
  ).toContain("/api/auth/vercel?next=");
  expect(await recoveryAuthorizePath(request)).toBe("/connections");
  expect(
    await recoveryAuthorizePath({
      ...request,
      user_id: "00000000-0000-4000-8000-000000000099",
    })
  ).toBeNull();
  await db.query(
    "update connections set approval_mode='auto',type='rest_api' where id=$1",
    [conn]
  );
  expect(await checkConnectionRecoveryAccess(request)).toMatchObject({
    ready: false,
    message: expect.stringContaining("provider-specific"),
  });
  await db.query("update connections set type='mcp_server' where id=$1", [
    conn,
  ]);
  const cleanup = vi.fn(async () => {});
  expect(
    await checkConnectionRecoveryAccess(request, {
      getMcpTools: async () => ({ tools: {}, cleanup }),
    })
  ).toMatchObject({ ready: true });
  expect(cleanup).toHaveBeenCalledOnce();
  expect(
    await checkConnectionRecoveryAccess(request, {
      getMcpTools: async () => {
        throw new Error("private credential data");
      },
    })
  ).toMatchObject({
    ready: false,
    message: expect.not.stringContaining("private credential"),
  });
});
