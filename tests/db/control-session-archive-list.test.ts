import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createPostgrestShim } from "@/lib/db/postgrest-shim";
import { SHIM_TYPE_PARSERS } from "@/lib/db/pool";
import {
  createControlSessionsGetHandler,
  createControlSessionsPutHandler,
} from "@/app/api/control/sessions/route";

const owner = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
let db: PGlite;
let client: SupabaseClient;
beforeAll(async () => {
  db = new PGlite({
    parsers: Object.fromEntries(
      Object.entries(SHIM_TYPE_PARSERS).map(([oid, parse]) => [
        Number(oid),
        parse,
      ])
    ),
  });
  await db.exec(
    "create role anon; create role authenticated; create role service_role; create table external_agent_runs (id uuid primary key, user_id uuid, repo_id uuid, sandbox_record_id uuid);"
  );
  for (const migration of [
    "20260807190000_orchestration_runs.sql",
    "20260810180000_control_sessions.sql",
    "20260810190000_control_sessions_project.sql",
    "20260812120000_control_sessions_repo.sql",
    "20260813120000_orchestration_worktrees.sql",
    "20260830120000_control_session_model.sql",
  ])
    await db.exec(
      await readFile(
        new URL(`../../neon/migrations/${migration}`, import.meta.url),
        "utf8"
      )
    );
  client = createPostgrestShim({
    query: async (sql, values) => {
      const result = await db.query(sql, values ?? []);
      return { rows: result.rows as Record<string, unknown>[] };
    },
  }) as unknown as SupabaseClient;
  await db.exec(
    "create table ai_calls (id uuid primary key default gen_random_uuid(), user_id uuid, conversation_id text, status text);"
  );
}, 30_000);
afterAll(async () => {
  await db.close();
});

it("lists and restores only the owner's archives across page boundaries without deleting transcripts", async () => {
  await db.query(
    'insert into control_sessions (user_id, title, archived, messages) select $1, \'Archived \' || n, true, \'[{"role":"user","parts":[]}]\'::jsonb from generate_series(1, 201) n',
    [owner]
  );
  await db.query(
    "insert into control_sessions (user_id, title, archived) values ($1, 'Active', false), ($2, 'Other archive', true)",
    [owner, other]
  );
  const get = createControlSessionsGetHandler({
    client,
    requireUserId: async () => owner,
  });
  const list = async (query = "") =>
    (
      await get(new Request(`https://app.test/api/control/sessions${query}`))
    ).json();
  const active = await list();
  expect(active.map((row: { title: string }) => row.title)).toEqual(["Active"]);
  const first = await list("?archived=true");
  const second = await list("?archived=true&offset=200");
  expect(first).toHaveLength(200);
  expect(second).toHaveLength(1);
  expect(new Set([...first, ...second].map((row) => row.id)).size).toBe(201);
  expect(
    [...first, ...second].some((row) => row.title === "Other archive")
  ).toBe(false);
  const put = createControlSessionsPutHandler({
    client,
    requireUserId: async () => owner,
  });
  const target = first[0];
  const update = (expected: string) =>
    put(
      new Request("https://app.test/api/control/sessions", {
        method: "PUT",
        body: JSON.stringify({
          id: target.id,
          archived: false,
          expected_updated_at: expected,
        }),
      })
    );
  expect((await update("2000-01-01T00:00:00Z")).status).toBe(409);
  expect((await update(target.updated_at)).status).toBe(200);
  expect(await list()).toHaveLength(2);
  const record = await (
    await get(
      new Request(`https://app.test/api/control/sessions?id=${target.id}`)
    )
  ).json();
  expect(record.archived).toBe(false);
  expect(record.messages).toEqual([{ role: "user", parts: [] }]);
  expect(await list("?archived=true&offset=200")).toEqual([]);
  const archivedRevision = record.updated_at;
  const archive = () =>
    put(
      new Request("https://app.test/api/control/sessions", {
        method: "PUT",
        body: JSON.stringify({
          id: target.id,
          archived: true,
          expected_updated_at: archivedRevision,
        }),
      })
    );
  await db.query(
    "insert into ai_calls(user_id, conversation_id, status) values ($1, $2, 'streaming')",
    [owner, target.id]
  );
  expect((await archive()).status).toBe(409);
  expect(await list()).toHaveLength(2);
  await db.query("update ai_calls set status = 'success'");
  expect((await archive()).status).toBe(200);
  expect(await list()).toHaveLength(1);
});
