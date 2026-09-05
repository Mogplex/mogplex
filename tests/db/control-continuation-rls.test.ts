import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { controlContinuationDatabase } from "../support/control-continuation-database";

it("Supabase realtime can read only the owner's follow-ups and cannot mutate them", async () => {
  const f = await controlContinuationDatabase("supabase");
  try {
    await f.db.exec(`
      create function public.current_profile_id() returns uuid language sql stable as
        $$ select nullif(current_setting('test.profile_id', true), '')::uuid $$;
      create publication supabase_realtime;
    `);
    // Reapplying the migration must wire a backend whose realtime publication
    // exists, while the shared fixture also exercises installs without one.
    await f.db.exec(
      await readFile(
        "supabase/migrations/20260905193000_control_continuations.sql",
        "utf8"
      )
    );
    const { continuation } = await f.rpc<{ continuation: { id: string } }>(
      "control_register_continuation",
      f.registerArgs
    );
    await f.db.query("select set_config('test.profile_id',$1,false)", [
      f.owner,
    ]);
    await f.db.exec("set role authenticated");
    expect(
      (await f.db.query("select id from control_continuations")).rows
    ).toEqual([{ id: continuation.id }]);
    await expect(
      f.db.query(
        "update control_continuations set status='running' where id=$1",
        [continuation.id]
      )
    ).rejects.toThrow(/permission denied/);
    await f.db.query("select set_config('test.profile_id',$1,false)", [
      randomUUID(),
    ]);
    expect(
      (await f.db.query("select id from control_continuations")).rows
    ).toEqual([]);
    await f.db.exec("reset role");
    expect(
      (
        await f.db.query<{ tablename: string }>(
          "select tablename from pg_publication_tables where pubname='supabase_realtime' order by tablename"
        )
      ).rows
    ).toEqual([
      { tablename: "control_continuations" },
      { tablename: "control_sessions" },
    ]);
  } finally {
    await f.db.close();
  }
});
