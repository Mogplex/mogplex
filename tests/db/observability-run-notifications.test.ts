import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";

it("publishes user-scoped run and approval changes, idempotently and without content", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      "create table external_agent_runs(id text,user_id text,prompt text); create table flow_waits(id text,user_id text,prompt text);"
    );
    await db.exec(
      await readFile(
        "neon/migrations/20260803010000_realtime_notify_triggers.sql",
        "utf8"
      )
    );
    const migration = await readFile(
      "neon/migrations/20260905154000_observability_run_notifications.sql",
      "utf8"
    );
    await db.exec(migration);
    await db.exec(migration);
    const events: unknown[] = [];
    const unlisten = await db.listen("mogplex_table_events", (payload) =>
      events.push(JSON.parse(payload))
    );
    for (const table of ["external_agent_runs", "flow_waits"]) {
      await db.exec(
        `insert into ${table} values ('run','owner','private task'); update ${table} set prompt='private update'; delete from ${table};`
      );
    }
    expect(events).toEqual(
      ["external_agent_runs", "flow_waits"].flatMap((table) =>
        ["INSERT", "UPDATE", "DELETE"].map((op) => ({
          table,
          op,
          user_id: "owner",
          id: "run",
        }))
      )
    );
    await unlisten();
  } finally {
    await db.close();
  }
});

it("adds run and approval tables to an existing Supabase publication idempotently", async () => {
  const db = new PGlite();
  try {
    const migration = await readFile(
      "supabase/migrations/20260905154000_observability_run_notifications.sql",
      "utf8"
    );
    await db.exec(migration);
    await db.exec(
      "create table external_agent_runs(id text); create table flow_waits(id text); create publication supabase_realtime;"
    );
    await db.exec(migration);
    await db.exec(migration);
    const result = await db.query(
      "select tablename from pg_publication_tables where pubname='supabase_realtime' order by tablename"
    );
    expect(result.rows).toEqual([
      { tablename: "external_agent_runs" },
      { tablename: "flow_waits" },
    ]);
  } finally {
    await db.close();
  }
});
