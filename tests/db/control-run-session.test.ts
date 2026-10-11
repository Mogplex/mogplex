import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { vector } from "@electric-sql/pglite/vector";
import { applyNeonMigrations } from "@/lib/db/neon-migrations";
import { SHIM_TYPE_PARSERS } from "@/lib/db/pool";
import { NextResponse } from "next/server";
import { beforeAll, afterAll, beforeEach, expect, test } from "vitest";
import { createPostgrestShim } from "@/lib/db/postgrest-shim";
import { openRunInControl } from "@/lib/control/run-session";
import { createControlRunPostHandler } from "@/app/api/control/runs/[runId]/route";

const owner = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const runId = "00000000-0000-4000-8000-000000000003";
const repoId = "00000000-0000-4000-8000-000000000004";
let db: PGlite;
let client: NonNullable<Parameters<typeof openRunInControl>[3]>;
beforeAll(async () => {
  db = await PGlite.create({
    extensions: { vector, pg_trgm, pgcrypto, uuid_ossp },
    parsers: Object.fromEntries(
      Object.entries(SHIM_TYPE_PARSERS).map(([oid, parse]) => [
        Number(oid),
        parse,
      ])
    ),
  });
  expect(
    (await applyNeonMigrations(db, { log: () => {}, warn: () => {} })).ok
  ).toBe(true);
  await db.exec(`
    insert into profiles(id) values ('${owner}'),('${other}');
    insert into workspaces(id,user_id,owner_user_id,name) values ('${repoId}','${owner}','${owner}','Widgets');
    insert into repos(id,user_id,owner_user_id,workspace_id,full_name,owner,name) values ('${repoId}','${owner}','${owner}','${repoId}','acme/widgets','acme','widgets');
    insert into ai_calls(id,user_id,type,model,repo_id) values ('${runId}','${owner}','agent','fixture','${repoId}');
    insert into external_agent_runs(id,user_id,repo_id,ai_call_id,idempotency_key,request_hash,harness,status,prompt,base_branch,working_branch,metadata) values ('${runId}','${owner}','${repoId}','${runId}','open-once','hash','mogplex','failed','Fix the header','main','fix/header','{}');
  `);
  client = createPostgrestShim({
    query: async (sql, values) => ({
      rows: (await db.query(sql, values)).rows as Record<string, unknown>[],
    }),
  }) as unknown as typeof client;
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.exec(
    "delete from control_sessions; delete from ai_call_events; update external_agent_runs set status='failed'"
  );
});

test("opening a run creates one owned reference and preserves renamed history on repeat", async () => {
  const [first, repeated] = await Promise.all([
    openRunInControl(owner, runId, false, client),
    openRunInControl(owner, runId, false, client),
  ]);
  expect(first.id).toBe(runId);
  expect(repeated.id).toBe(first.id);
  expect(first.messages).toEqual([]);
  expect(first.orchestration_run_id).toBeNull();
  await db.query(
    "update control_sessions set title='My task',archived=true,messages=$1 where id=$2",
    [
      JSON.stringify([
        {
          id: "saved",
          role: "user",
          parts: [{ type: "text", text: "Keep this" }],
        },
      ]),
      runId,
    ]
  );
  expect(await openRunInControl(owner, runId, false, client)).toMatchObject({
    title: "My task",
    archived: false,
    messages: [{ id: "saved" }],
  });
  expect(
    (await db.query("select count(*)::int count from control_sessions")).rows
  ).toEqual([{ count: 1 }]);
  expect(
    (await db.query("select count(*)::int count from external_agent_runs")).rows
  ).toEqual([{ count: 1 }]);
});

test("another owner cannot open or continue a run", async () => {
  for (const continuation of [false, true])
    await expect(
      openRunInControl(other, runId, continuation, client)
    ).rejects.toMatchObject({ status: 404 });
  expect(
    (await db.query("select count(*)::int count from control_sessions")).rows
  ).toEqual([{ count: 0 }]);
});

test("pending, working and checkpointed runs reject continuation without changing history", async () => {
  for (const status of ["pending", "streaming", "awaiting_input"]) {
    await db.query("update external_agent_runs set status=$1", [status]);
    await expect(
      openRunInControl(owner, runId, true, client)
    ).rejects.toMatchObject({ status: 409 });
  }
  expect(
    (await db.query("select count(*)::int count from control_sessions")).rows
  ).toEqual([{ count: 0 }]);
});

test("continuation reads every saved event, excludes other owners, and is idempotent", async () => {
  await db.query(
    `insert into ai_call_events(user_id,ai_call_id,event_type,message,payload,created_at) select $1,$2,'log','History ' || n || E'\n','{"kind":"assistant_delta"}'::jsonb, now() + n * interval '1 second' from generate_series(1,201) n`,
    [owner, runId]
  );
  await db.query(
    "insert into ai_call_events(user_id,ai_call_id,event_type,message,payload) values ($1,$2,'log','Foreign history','{\"kind\":\"assistant_delta\"}')",
    [other, runId]
  );
  const [first, repeated] = await Promise.all([
    openRunInControl(owner, runId, true, client),
    openRunInControl(owner, runId, true, client),
  ]);
  expect(repeated.messages).toEqual(first.messages);
  expect(first.messages).toHaveLength(2);
  expect(JSON.stringify(first.messages)).toContain("History 201");
  expect(JSON.stringify(first.messages)).not.toContain("Foreign history");
  expect(await openRunInControl(owner, runId, true, client)).toMatchObject({
    id: first.id,
    messages: first.messages,
  });
});

test("the HTTP boundary validates auth and run id and returns the owned session", async () => {
  const openRun: typeof openRunInControl = (userId, id, continuation) =>
    openRunInControl(userId, id, continuation, client);
  for (const [user, id, status] of [
    [null, runId, 401],
    [owner, "bad", 400],
    [other, runId, 404],
    [owner, runId, 200],
  ] as const) {
    const handler = createControlRunPostHandler({
      requireUserId: async () =>
        user ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      openRun,
    });
    const response = await handler(
      new Request("https://example.test/api/control/runs", { method: "POST" }),
      { params: Promise.resolve({ runId: id }) }
    );
    expect(response.status).toBe(status);
    if (status === 200)
      expect(await response.json()).toMatchObject({
        id: runId,
        repo_id: repoId,
      });
  }
});
