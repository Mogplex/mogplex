import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import { NextRequest } from "next/server";
import { createPostgrestShim, type Queryable } from "@/lib/db/postgrest-shim";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createObservabilityCallsGetHandler } from "@/app/api/observability/calls/route";

it("looks up an old exact call before pagination while retaining owner and conversation isolation", async () => {
  const pg = await PGlite.create();
  const previousFrom = Object.getOwnPropertyDescriptor(supabaseAdmin, "from");
  try {
    await pg.exec(`create table ai_calls(id uuid primary key, user_id text, conversation_id text,
      type text default 'chat', status text default 'failed', started_at timestamptz default now(),
      metadata jsonb default '{}', tool_calls jsonb default '[]');`);
    const old = "00000000-0000-4000-8000-000000000001";
    const otherConversation = "00000000-0000-4000-8000-000000000002";
    const otherUser = "00000000-0000-4000-8000-000000000003";
    await pg.query(
      `insert into ai_calls(id,user_id,conversation_id,started_at) values
      ($1,'owner','conversation',now()-interval '1 day'),
      ($2,'owner','elsewhere',now()), ($3,'other','conversation',now())`,
      [old, otherConversation, otherUser]
    );
    await pg.exec(`insert into ai_calls(id,user_id,conversation_id)
      select gen_random_uuid(),'owner','conversation' from generate_series(1,101);`);
    const queryable: Queryable = {
      query: async (sql, values) => {
        const result = await pg.query(sql, values);
        return { rows: result.rows as Record<string, unknown>[] };
      },
    };
    const db = createPostgrestShim(queryable);
    Object.defineProperty(supabaseAdmin, "from", {
      configurable: true,
      value: db.from.bind(db),
    });
    const handler = createObservabilityCallsGetHandler({
      requireUserId: async () => "owner",
    });
    const base =
      "http://localhost/api/observability/calls?conversation_id=conversation&limit=100&sort=started_at&order=desc";
    const recent = await (await handler(new NextRequest(base))).json();
    expect(recent.calls).toHaveLength(100);
    expect(recent.calls.some((call: { id: string }) => call.id === old)).toBe(
      false
    );
    const response = await handler(
      new NextRequest(
        `${base}&call_ids=${old},${otherConversation},${otherUser}`
      )
    );
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.calls.map((call: { id: string }) => call.id)).toEqual([old]);
    expect(result.total).toBe(1);
  } finally {
    if (previousFrom)
      Object.defineProperty(supabaseAdmin, "from", previousFrom);
    else Reflect.deleteProperty(supabaseAdmin, "from");
    await pg.close();
  }
});
