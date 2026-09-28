import { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { createPostgrestShim } from "@/lib/db/postgrest-shim";
import {
  deleteMogplexApiRepoEnvVar,
  listMogplexApiRepoEnvVars,
  upsertMogplexApiRepoEnvVar,
} from "@/lib/mogplex-api/env-vars";
import { resolveRepoSandboxEnv } from "@/lib/vercel/env-vars";
import { NextRequest } from "next/server";
import { MogplexApiClient } from "@/lib/mogplex-api/client";
import { handleMogplexMcpPayload } from "@/lib/mogplex-api/mcp";
import { createMogplexApiRepoEnvVarsPostHandler } from "@/app/api/v1/mogplex/repos/[repoId]/env-vars/route";

const owner = "00000000-0000-4000-8000-000000000001";
const stranger = "00000000-0000-4000-8000-000000000002";
let db: PGlite;
let client: SupabaseClient;

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(
    "create table repos(id text primary key, user_id uuid, sandbox_env_vars jsonb)"
  );
  client = createPostgrestShim({
    query: async (sql, values) => ({
      rows: (await db.query(sql, values)).rows as Record<string, unknown>[],
    }),
  }) as unknown as SupabaseClient;
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.exec("delete from repos");
  await db.query("insert into repos values ('repo', $1, $2)", [
    owner,
    { KEEP: "existing-secret" },
  ]);
});

async function readEnv() {
  const result = await db.query<{ sandbox_env_vars: Record<string, string> }>(
    "select sandbox_env_vars from repos where id='repo'"
  );
  return result.rows[0].sandbox_env_vars;
}

it("sets, updates, lists and deletes owned project variables without a Vercel connection", async () => {
  const value = "line one\nline two=$value 'quoted'";
  const created = await upsertMogplexApiRepoEnvVar(
    owner,
    "repo",
    { key: "API_KEY", value },
    { client }
  );
  expect(created).toEqual({
    ok: true,
    data: { action: "created", key: "API_KEY", updatedCount: 1 },
  });
  expect(await readEnv()).toEqual({ KEEP: "existing-secret", API_KEY: value });
  const listed = await listMogplexApiRepoEnvVars(owner, "repo", { client });
  expect(listed.ok).toBe(true);
  if (listed.ok)
    expect(listed.data.envVars.map((entry) => entry.key)).toEqual([
      "API_KEY",
      "KEEP",
    ]);
  expect(JSON.stringify(listed)).not.toContain("existing-secret");
  expect(JSON.stringify(listed)).not.toContain("line one");
  expect(
    await upsertMogplexApiRepoEnvVar(
      owner,
      "repo",
      { key: "API_KEY", value: "" },
      { client }
    )
  ).toMatchObject({ ok: true, data: { action: "updated" } });
  const runtime = await resolveRepoSandboxEnv({
    userId: owner,
    repo: { sandbox_env_vars: await readEnv(), env_sync_mode: "manual" },
  });
  expect(runtime.envVars).toEqual({ KEEP: "existing-secret", API_KEY: "" });
  expect(
    await deleteMogplexApiRepoEnvVar(
      owner,
      "repo",
      { key: "API_KEY" },
      { client }
    )
  ).toEqual({ ok: true, data: { key: "API_KEY", deletedCount: 1 } });
  expect(await readEnv()).toEqual({ KEEP: "existing-secret" });
  expect(
    await deleteMogplexApiRepoEnvVar(
      owner,
      "repo",
      { key: "MISSING" },
      { client }
    )
  ).toMatchObject({ ok: false, error: { status: 404 } });
});

it("does not reveal or mutate another user's project", async () => {
  expect(
    await listMogplexApiRepoEnvVars(stranger, "repo", { client })
  ).toMatchObject({ ok: false, error: { status: 404 } });
  expect(
    await upsertMogplexApiRepoEnvVar(
      stranger,
      "repo",
      { key: "KEEP", value: "changed" },
      { client }
    )
  ).toMatchObject({ ok: false, error: { status: 404 } });
  expect(
    await deleteMogplexApiRepoEnvVar(
      stranger,
      "repo",
      { key: "KEEP" },
      { client }
    )
  ).toMatchObject({ ok: false, error: { status: 404 } });
  expect(await readEnv()).toEqual({ KEEP: "existing-secret" });
});

it("initializes null settings and preserves valid special keys", async () => {
  await db.exec("update repos set sandbox_env_vars=null");
  expect(
    await upsertMogplexApiRepoEnvVar(
      owner,
      "repo",
      { key: "__proto__", value: "literal" },
      { client }
    )
  ).toMatchObject({ ok: true });
  expect(Object.entries(await readEnv())).toEqual([["__proto__", "literal"]]);
});

it("reports a conflict instead of overwriting a concurrent settings edit", async () => {
  const racingClient = createPostgrestShim({
    query: async (sql, values) => {
      if (/^UPDATE/i.test(sql.trim()))
        await db.exec(
          `update repos set sandbox_env_vars=sandbox_env_vars || '{"OTHER":"concurrent"}'::jsonb`
        );
      return {
        rows: (await db.query(sql, values)).rows as Record<string, unknown>[],
      };
    },
  }) as unknown as SupabaseClient;
  expect(
    await upsertMogplexApiRepoEnvVar(
      owner,
      "repo",
      { key: "NEW", value: "value" },
      { client: racingClient }
    )
  ).toMatchObject({ ok: false, error: { status: 409 } });
  expect(await readEnv()).toEqual({
    KEEP: "existing-secret",
    OTHER: "concurrent",
  });
});

it("rejects Vercel-only options without changing sandbox variables", async () => {
  for (const input of [{ target: ["production"] }, { type: "encrypted" }]) {
    expect(
      await upsertMogplexApiRepoEnvVar(
        owner,
        "repo",
        { key: "NEW", value: "value", ...input },
        { client }
      )
    ).toMatchObject({ ok: false, error: { status: 400 } });
  }
  expect(await readEnv()).toEqual({ KEEP: "existing-secret" });
});

it("persists an MCP tool call through the API into sandbox launch settings", async () => {
  const handler = createMogplexApiRepoEnvVarsPostHandler({
    resolveApiKey: async () => ({
      ok: true,
      auth: { userId: owner, keyId: "test-key", scopes: ["write"] },
    }),
    upsertEnvVar: (userId, repoId, input) =>
      upsertMogplexApiRepoEnvVar(userId, repoId, input, { client }),
  });
  const api = new MogplexApiClient({
    baseUrl: "https://mogplex.example",
    authorization: "mog_test",
    fetch: async (url, init) =>
      handler(
        new NextRequest(String(url), {
          ...init,
          signal: init?.signal ?? undefined,
        }),
        {
          params: Promise.resolve({ repoId: "repo" }),
        }
      ),
  });
  const result = await handleMogplexMcpPayload(
    {
      jsonrpc: "2.0",
      id: "set",
      method: "tools/call",
      params: {
        name: "mogplex_set_env_var",
        arguments: { repoId: "repo", key: "MCP_TEST", value: "private-value" },
      },
    },
    { client: api }
  );
  expect(result).toMatchObject({
    result: {
      isError: false,
      structuredContent: { action: "created", key: "MCP_TEST" },
    },
  });
  expect(JSON.stringify(result)).not.toContain("private-value");
  expect(await readEnv()).toEqual({
    KEEP: "existing-secret",
    MCP_TEST: "private-value",
  });
});

it("sanitizes database failures on reads and writes", async () => {
  const database = db;
  for (const operation of ["read", "write"]) {
    const failingClient = createPostgrestShim({
      query: async (sql, values) => {
        if (operation === "read" || /^UPDATE/i.test(sql.trim()))
          throw new Error("database detail with secret-value");
        return {
          rows: (await database.query(sql, values)).rows as Record<
            string,
            unknown
          >[],
        };
      },
    }) as unknown as SupabaseClient;
    const result = await upsertMogplexApiRepoEnvVar(
      owner,
      "repo",
      { key: "NEW", value: "secret-value" },
      { client: failingClient }
    );
    expect(result).toMatchObject({ ok: false, error: { status: 500 } });
    expect(JSON.stringify(result)).not.toContain("secret-value");
  }
});

it("does not delete over a concurrent edit", async () => {
  const racingClient = createPostgrestShim({
    query: async (sql, values) => {
      if (/^UPDATE/i.test(sql.trim()))
        await db.exec(
          `update repos set sandbox_env_vars='{"KEEP":"new-value"}'::jsonb`
        );
      return {
        rows: (await db.query(sql, values)).rows as Record<string, unknown>[],
      };
    },
  }) as unknown as SupabaseClient;
  expect(
    await deleteMogplexApiRepoEnvVar(
      owner,
      "repo",
      { key: "KEEP" },
      { client: racingClient }
    )
  ).toMatchObject({ ok: false, error: { status: 409 } });
  expect(await readEnv()).toEqual({ KEEP: "new-value" });
});
