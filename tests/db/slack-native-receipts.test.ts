import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { expect, test } from "vitest";

test("native Slack receipts atomically claim one attempt and retain failed claims", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create table public.profiles (id uuid primary key);
      insert into public.profiles values ('00000000-0000-4000-8000-000000000001');
    `);
    await db.exec(
      await readFile(
        path.resolve(
          import.meta.dirname,
          "../../supabase/migrations/20260727010000_slack_tool_execution_idempotency.sql"
        ),
        "utf8"
      )
    );
    const reserve = (scope = "slack-webhook:T1:U1") =>
      db.query(
        `
      insert into public.slack_tool_executions
        (user_id, scope_key, tool_name, input_hash, occurrence)
      values ($1, $2, 'slack_webhook_command', $3, 1) returning id
    `,
        ["00000000-0000-4000-8000-000000000001", scope, "a".repeat(64)]
      );
    const attempts = await Promise.allSettled([reserve(), reserve()]);
    expect(
      attempts.filter((result) => result.status === "fulfilled")
    ).toHaveLength(1);
    expect(
      attempts.filter((result) => result.status === "rejected")
    ).toHaveLength(1);
    await db.exec("update public.slack_tool_executions set status = 'failed'");
    await expect(reserve()).rejects.toThrow(/unique|duplicate/i);
    await reserve("slack-webhook:T2:U1");
    await reserve("slack-webhook:T1:U2");
    const { rows } = await db.query(`select
      (select count(*)::int from public.slack_tool_executions) as receipts,
      has_table_privilege('anon', 'public.slack_tool_executions', 'select') as anon_read,
      has_table_privilege('authenticated', 'public.slack_tool_executions', 'insert') as auth_write,
      has_table_privilege('service_role', 'public.slack_tool_executions', 'insert') as service_write`);
    expect(rows[0]).toEqual({
      receipts: 3,
      anon_read: false,
      auth_write: false,
      service_write: true,
    });
  } finally {
    await db.close();
  }
});
