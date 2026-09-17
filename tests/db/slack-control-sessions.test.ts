import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { vector } from "@electric-sql/pglite/vector";
import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { applyNeonMigrations } from "@/lib/db/neon-migrations";
import { createPostgrestShim } from "@/lib/db/postgrest-shim";
import { createControlSessionsGetHandler } from "@/app/api/control/sessions/route";

test("Slack runs atomically create one owned Control session without starting another run", async () => {
  const db = await PGlite.create({
    extensions: { vector, pg_trgm, pgcrypto, uuid_ossp },
  });
  try {
    expect(
      (await applyNeonMigrations(db, { log: () => {}, warn: () => {} })).ok
    ).toBe(true);
    const owner = "00000000-0000-4000-8000-000000000001";
    const other = "00000000-0000-4000-8000-000000000002";
    const repo = "00000000-0000-4000-8000-000000000003";
    const run = "00000000-0000-4000-8000-000000000004";
    await db.query("insert into profiles(id) values ($1),($2)", [owner, other]);
    await db.query(
      "insert into workspaces(id,user_id,owner_user_id,name) values ($1,$2,$2,'Widgets')",
      [repo, owner]
    );
    await db.query(
      "insert into repos(id,user_id,owner_user_id,workspace_id,full_name,owner,name) values ($1,$2,$2,$1,'acme/widgets','acme','widgets')",
      [repo, owner]
    );
    await db.query(
      "insert into ai_calls(id,user_id,type,model,repo_id) values ($1,$2,'agent','fixture',$3)",
      [run, owner, repo]
    );
    await db.query(
      "insert into external_agent_runs(id,user_id,repo_id,ai_call_id,idempotency_key,request_hash,harness,status,prompt,base_branch,working_branch,metadata) values ($1,$2,$3,$1,'slack-once','hash','mogplex','pending','Fix the mobile hero','main','fix/hero',$4)",
      [
        run,
        owner,
        repo,
        { run_origin: "slack", slack_task_title: "Mobile hero" },
      ]
    );
    const client = createPostgrestShim({
      query: async (sql, values) => ({
        rows: (await db.query<Record<string, unknown>>(sql, values ?? [])).rows,
      }),
    });
    const get = createControlSessionsGetHandler({
      requireUserId: async () => owner,
      client: client as unknown as NonNullable<
        Parameters<typeof createControlSessionsGetHandler>[0]
      >["client"],
    });
    const response = await get(
      new Request("https://example.test/api/control/sessions")
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      expect.objectContaining({
        id: run,
        external_run_id: run,
        title: "Mobile hero",
        project: "acme/widgets",
        repo_id: repo,
      }),
    ]);
    const foreignGet = createControlSessionsGetHandler({
      requireUserId: async () => other,
      client: client as unknown as NonNullable<
        Parameters<typeof createControlSessionsGetHandler>[0]
      >["client"],
    });
    expect(
      await (
        await foreignGet(
          new Request("https://example.test/api/control/sessions")
        )
      ).json()
    ).toEqual([]);
    expect(
      (
        await foreignGet(
          new Request(`https://example.test/api/control/sessions?id=${run}`)
        )
      ).status
    ).toBe(404);
    await db.query(
      "update control_sessions set title='Renamed',archived=true where id=$1",
      [run]
    );
    await db.query(
      "update external_agent_runs set status='failed' where id=$1",
      [run]
    );
    expect(
      (
        await db.query(
          "select title,archived from control_sessions where id=$1",
          [run]
        )
      ).rows
    ).toEqual([{ title: "Renamed", archived: true }]);
    expect(
      (await db.query("select count(*)::int as count from external_agent_runs"))
        .rows
    ).toEqual([{ count: 1 }]);
    expect(
      (await db.query("select count(*)::int as count from orchestration_runs"))
        .rows
    ).toEqual([{ count: 0 }]);

    // Simulate already accepted Slack work from before this migration, then
    // apply twice. Existing archive/rename choices must survive the backfill.
    await db.exec(
      "drop trigger external_run_control_session on external_agent_runs"
    );
    const historicalRun = "00000000-0000-4000-8000-000000000005";
    await db.query(
      "insert into external_agent_runs(id,user_id,repo_id,ai_call_id,idempotency_key,request_hash,harness,status,prompt,base_branch,working_branch,metadata) values ($1,$2,$3,$4,'historical-slack','hash','mogplex','failed','An older Slack request','main','fix/older',$5)",
      [historicalRun, owner, repo, run, { run_origin: "slack" }]
    );
    const migration = readFileSync(
      "neon/migrations/20260917172000_slack_control_sessions.sql",
      "utf8"
    );
    await db.exec(migration);
    await db.exec(migration);
    expect(
      (
        await db.query(
          "select id,title,archived from control_sessions order by id"
        )
      ).rows
    ).toEqual([
      { id: run, title: "Renamed", archived: true },
      { id: historicalRun, title: "An older Slack request", archived: false },
    ]);
    await db.query(
      "insert into external_agent_runs(user_id,repo_id,ai_call_id,idempotency_key,request_hash,harness,status,prompt,base_branch,working_branch,metadata) values ($1,$2,$3,'api-only','hash','mogplex','pending','API request','main','fix/api',$4)",
      [owner, repo, run, { run_origin: "api" }]
    );
    expect(
      (await db.query("select count(*)::int as count from control_sessions"))
        .rows
    ).toEqual([{ count: 2 }]);
  } finally {
    await db.close();
  }
}, 60_000);
