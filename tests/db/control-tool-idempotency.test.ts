import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import { createPostgrestShim } from "@/lib/db/postgrest-shim";
import {
  createSupabaseSlackToolExecutionStore,
  type SlackToolExecutionDatabase,
} from "@/lib/agents/slack-tool-idempotency-store";
import { wrapControlSideEffects } from "@/lib/control/tool-idempotency";
import {
  callTool,
  executableTool,
} from "../unit/helpers/slack-tool-idempotency-fixtures";

it("different coordinator instances share durable reservations and replay completed writes", async () => {
  const db = await PGlite.create();
  const userId = randomUUID();
  try {
    await db.exec(
      "create role anon; create role authenticated; create role service_role; create table profiles(id uuid primary key);"
    );
    await db.query("insert into profiles values($1)", [userId]);
    await db.exec(
      await readFile(
        new URL(
          "../../supabase/migrations/20260727010000_slack_tool_execution_idempotency.sql",
          import.meta.url
        ),
        "utf8"
      )
    );
    const client = () =>
      createPostgrestShim({
        query: async (sql, values) => ({
          rows: (await db.query(sql, values)).rows as Record<string, unknown>[],
        }),
      }) as unknown as SupabaseClient<SlackToolExecutionDatabase>;
    const store = () =>
      createSupabaseSlackToolExecutionStore(async () => client());
    let writes = 0;
    let finish: (() => void) | undefined;
    let started: (() => void) | undefined;
    const began = new Promise<void>((resolve) => {
      started = resolve;
    });
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const context = { userId, aiCallId: randomUUID() };
    const tools = {
      open_pr: executableTool(async () => {
        writes++;
        started?.();
        await pending;
        return { ok: true, number: 42 };
      }),
    };
    const first = callTool(
      wrapControlSideEffects(tools, context, store()),
      "open_pr"
    );
    await began;
    const duplicate = await callTool(
      wrapControlSideEffects(tools, context, store()),
      "open_pr"
    );
    expect(duplicate).toMatchObject({ ok: false, deduplicated: true });
    finish?.();
    expect(await first).toEqual({ ok: true, number: 42 });
    expect(
      await callTool(wrapControlSideEffects(tools, context, store()), "open_pr")
    ).toEqual({ ok: true, number: 42 });
    expect(writes).toBe(1);
    expect(
      (await db.query("select status, output from slack_tool_executions")).rows
    ).toEqual([{ status: "completed", output: { ok: true, number: 42 } }]);
  } finally {
    await db.close();
  }
});
