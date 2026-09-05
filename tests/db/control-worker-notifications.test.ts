import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";

it("adds worktrees to the Supabase realtime publication idempotently", async () => {
  const db = new PGlite();
  try {
    const migration = await readFile(
      new URL(
        "../../supabase/migrations/20260905180000_control_worker_notifications.sql",
        import.meta.url
      ),
      "utf8"
    );
    await db.exec(migration);
    await db.exec(
      "create table orchestration_worktrees(id uuid); create publication supabase_realtime;"
    );
    await db.exec(migration);
    await db.exec(migration);
    expect(
      (
        await db.query(
          "select tablename from pg_publication_tables where pubname='supabase_realtime'"
        )
      ).rows
    ).toEqual([{ tablename: "orchestration_worktrees" }]);
  } finally {
    await db.close();
  }
});

it("publishes owned worker and worktree changes after the coordinator has finished", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create table external_agent_runs (id uuid primary key, user_id uuid, status text);
      create table orchestration_worktrees (id uuid primary key, user_id uuid, status text);`);
    for (const file of [
      "20260803010000_realtime_notify_triggers.sql",
      "20260825153000_scope_ai_call_event_notifications.sql",
      "20260905154000_observability_run_notifications.sql",
      "20260905180000_control_worker_notifications.sql",
      "20260905180000_control_worker_notifications.sql",
    ]) {
      await db.exec(
        await readFile(
          new URL(`../../neon/migrations/${file}`, import.meta.url),
          "utf8"
        )
      );
    }
    const events: Record<string, unknown>[] = [];
    const unlisten = await db.listen("mogplex_table_events", (payload) =>
      events.push(JSON.parse(payload))
    );
    for (const table of ["external_agent_runs", "orchestration_worktrees"]) {
      await db.exec(`insert into ${table} values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'running');
        update ${table} set status = 'failed';`);
    }
    expect(
      events.map(({ table, op, user_id }) => ({ table, op, user_id }))
    ).toEqual(
      ["external_agent_runs", "orchestration_worktrees"].flatMap((table) =>
        ["INSERT", "UPDATE"].map((op) => ({
          table,
          op,
          user_id: "00000000-0000-4000-8000-000000000002",
        }))
      )
    );
    await unlisten();
  } finally {
    await db.close();
  }
});
