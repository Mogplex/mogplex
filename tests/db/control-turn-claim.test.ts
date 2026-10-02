import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import { createPostgrestShim } from "@/lib/db/postgrest-shim";

const migration = () =>
  readFile(
    new URL(
      "../../neon/migrations/20261002180000_control_turn_claim.sql",
      import.meta.url
    ),
    "utf8"
  );
async function fixture() {
  const db = await PGlite.create();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table ai_calls(id uuid primary key default gen_random_uuid(), user_id uuid not null,
      conversation_id uuid, type text default 'agent', model text default 'fixture',
      status text default 'pending', metadata jsonb default '{}', started_at timestamptz default now());`);
  const client = createPostgrestShim({
    query: async (sql, values) => ({
      rows: (await db.query(sql, values)).rows as Record<string, unknown>[],
    }),
  });
  const owner = randomUUID();
  const conversation = randomUUID();
  const insert = (extra: Record<string, unknown> = {}) =>
    client
      .from("ai_calls")
      .insert({
        user_id: owner,
        conversation_id: conversation,
        metadata: { surface: "control" },
        ...extra,
      })
      .select("*")
      .single();
  return { db, client, owner, conversation, insert };
}

it("admits one concurrent turn and releases admission on every terminal status", async () => {
  const f = await fixture();
  try {
    await f.db.exec(await migration());
    const results = await Promise.all([f.insert(), f.insert()]);
    expect(results.filter((result) => !result.error)).toHaveLength(1);
    expect(results.find((result) => result.error)?.error?.code).toBe("23505");
    expect((await f.db.query("select id from ai_calls")).rows).toHaveLength(1);
    for (const status of ["success", "failed", "cancelled"]) {
      await f.db.query("update ai_calls set status=$1", [status]);
      expect((await f.insert()).error).toBeNull();
      expect((await f.insert()).error?.code).toBe("23505");
    }
  } finally {
    await f.db.close();
  }
});

it("preserves legacy duplicates without killing them and fences new turns until they finish", async () => {
  const f = await fixture();
  try {
    expect((await f.insert()).error).toBeNull();
    expect((await f.insert({ status: "streaming" })).error).toBeNull();
    await f.db.exec(await migration());
    await f.db.exec(await migration());
    expect(
      (
        await f.db.query(
          "select id from ai_calls where status in ('pending','streaming')"
        )
      ).rows
    ).toHaveLength(2);
    expect((await f.insert()).error?.code).toBe("23505");
    await f.db.exec(
      "update ai_calls set status='streaming', metadata=metadata || '{\"legacy_progress\":true}'::jsonb"
    );
    expect(
      (await f.db.query("select id from ai_calls where status='streaming'"))
        .rows
    ).toHaveLength(2);
    await f.db.exec("update ai_calls set status='failed'");
    await f.db.query(
      'insert into ai_calls(user_id,conversation_id,metadata,control_turn_guarded) values($1,$2,\'{"surface":"control"}\',false)',
      [f.owner, f.conversation]
    );
    await expect(
      f.db.query(
        'insert into ai_calls(user_id,conversation_id,metadata,control_turn_guarded) values($1,$2,\'{"surface":"control"}\',false)',
        [f.owner, f.conversation]
      )
    ).rejects.toMatchObject({ code: "23505" });
  } finally {
    await f.db.close();
  }
});

it("allows independent conversations and unrelated runs while guarding status transitions", async () => {
  const f = await fixture();
  try {
    await f.db.exec(await migration());
    expect((await f.insert()).error).toBeNull();
    for (const extra of [
      { conversation_id: randomUUID() },
      { user_id: randomUUID() },
      { conversation_id: null },
      { metadata: {} },
      { status: "success" },
    ])
      expect((await f.insert(extra)).error).toBeNull();
    const terminal = await f.insert({ status: "failed" });
    const id = (terminal.data as { id: string }).id;
    await expect(
      f.db.query("update ai_calls set status='streaming' where id=$1", [id])
    ).rejects.toMatchObject({ code: "23505" });
  } finally {
    await f.db.close();
  }
});
