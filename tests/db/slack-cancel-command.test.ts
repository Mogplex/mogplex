import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { vector } from "@electric-sql/pglite/vector";
import { expect, test } from "vitest";
import type { ExternalAgentRunRow } from "@/lib/mogplex-api/runs";
import { applyNeonMigrations } from "@/lib/db/neon-migrations";
import { createPostgrestShim } from "@/lib/db/postgrest-shim";

test("Slack cancellation respects owner, workspace, channel, actor and run state in Postgres", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  const { listSlackCancelableRuns } =
    await import("@/lib/slack/cancel-command");
  const { cancelMogplexApiRun } = await import("@/lib/mogplex-api/run-control");
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  const previousFrom = Object.getOwnPropertyDescriptor(supabaseAdmin, "from");
  const db = await PGlite.create({
    extensions: { vector, pg_trgm, pgcrypto, uuid_ossp },
  });
  const id = (n: number) =>
    `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const owner = id(1),
    other = id(2),
    repo = id(3);
  const scope = {
    userId: owner,
    teamId: "T1",
    channelId: "C1",
    slackUserId: "U1",
  };
  try {
    expect(
      (await applyNeonMigrations(db, { log: () => {}, warn: () => {} })).ok
    ).toBe(true);
    await db.query("insert into profiles(id) values($1),($2)", [owner, other]);
    await db.query(
      "insert into workspaces(id,user_id,owner_user_id,name) values($1,$2,$2,'Widgets')",
      [repo, owner]
    );
    await db.query(
      "insert into repos(id,user_id,owner_user_id,workspace_id,full_name,owner,name) values($1,$2,$2,$1,'acme/widgets','acme','widgets')",
      [repo, owner]
    );
    const variants = [
      { status: "streaming" },
      { status: "pending" },
      { status: "awaiting_input" },
      { status: "success" },
      { status: "failed" },
      { status: "cancelled" },
      { status: "streaming", userId: other },
      { status: "streaming", teamId: "T2" },
      { status: "streaming", channelId: "C2" },
      { status: "streaming", slackUserId: "U2" },
    ];
    for (const [index, variant] of variants.entries()) {
      const row = { ...scope, ...variant };
      await db.query(
        "insert into ai_calls(id,user_id,type,model,repo_id,status) values($1,$2,'agent','fixture',$3,'success')",
        [id(10 + index), row.userId, repo]
      );
      await db.query(
        "insert into external_agent_runs(id,user_id,repo_id,ai_call_id,idempotency_key,request_hash,harness,status,prompt,base_branch,working_branch,metadata) values($1,$2,$3,$1,($1::uuid)::text,'hash','mogplex',$4,'Fixture','main','fixture',$5)",
        [
          id(10 + index),
          row.userId,
          repo,
          row.status,
          {
            slack_user_id: row.slackUserId,
            slackRunControls: {
              teamId: row.teamId,
              channelId: row.channelId,
              messageTs: "1.2",
            },
          },
        ]
      );
    }
    const shim = createPostgrestShim({
      query: async (sql, values) => ({
        rows: (await db.query<Record<string, unknown>>(sql, values ?? [])).rows,
      }),
    });
    const client = shim as unknown as Pick<typeof supabaseAdmin, "from">;
    expect(
      (await listSlackCancelableRuns(scope, client)).map((row) => row.id).sort()
    ).toEqual([id(10), id(11), id(12)]);
    expect(
      await listSlackCancelableRuns({ ...scope, runId: id(13) }, client)
    ).toEqual([{ id: id(13), status: "success" }]);
    for (let index = 16; index < 20; index++) {
      expect(
        await listSlackCancelableRuns({ ...scope, runId: id(index) }, client)
      ).toEqual([]);
    }
    Object.defineProperty(supabaseAdmin, "from", {
      configurable: true,
      value: client.from.bind(client),
    });
    const result = await cancelMogplexApiRun({
      userId: owner,
      runId: id(12),
      deps: { notifyTerminal: async () => {} },
    });
    expect(result).toMatchObject({
      status: "cancelled",
      alreadyTerminal: false,
    });
    expect(
      (await db.query("select status from ai_calls where id=$1", [id(12)])).rows
    ).toEqual([{ status: "success" }]);
    expect(
      (
        await db.query("select status from external_agent_runs where id=$1", [
          id(12),
        ])
      ).rows
    ).toEqual([{ status: "cancelled" }]);
    await db.query(
      "update external_agent_runs set status='awaiting_input' where id=$1",
      [id(12)]
    );
    const paused = (
      await db.query<ExternalAgentRunRow>(
        "select * from external_agent_runs where id=$1",
        [id(12)]
      )
    ).rows[0];
    await expect(
      cancelMogplexApiRun({
        userId: owner,
        runId: id(12),
        deps: {
          loadRun: async () => {
            await db.query(
              "update external_agent_runs set status='streaming' where id=$1",
              [id(12)]
            );
            return paused;
          },
          notifyTerminal: async () => {
            throw new Error("must not notify when cancellation lost a race");
          },
        },
      })
    ).rejects.toThrow("Run state changed; retry cancellation");
    expect(
      (
        await db.query("select status from external_agent_runs where id=$1", [
          id(12),
        ])
      ).rows
    ).toEqual([{ status: "streaming" }]);
  } finally {
    if (previousFrom)
      Object.defineProperty(supabaseAdmin, "from", previousFrom);
    else Reflect.deleteProperty(supabaseAdmin, "from");
    await db.close();
  }
});
