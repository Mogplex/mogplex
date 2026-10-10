import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { vector } from "@electric-sql/pglite/vector";
import { expect, it } from "vitest";
import { NextRequest } from "next/server";
import { createObservabilityCallsGetHandler } from "@/app/api/observability/calls/route";
import { applyNeonMigrations } from "@/lib/db/neon-migrations";
import { SHIM_TYPE_PARSERS } from "@/lib/db/pool";
import { createPostgrestShim } from "@/lib/db/postgrest-shim";
import { supabaseAdmin } from "@/lib/supabase/admin";

it("sandbox activity includes native chat and harness commands without crossing owners or explicit bindings", async () => {
  const db = await PGlite.create({
    extensions: { vector, pg_trgm, pgcrypto, uuid_ossp },
    parsers: SHIM_TYPE_PARSERS,
  });
  const original = Object.getOwnPropertyDescriptor(supabaseAdmin, "from");
  const owner = "00000000-0000-4000-8000-000000000001";
  const other = "00000000-0000-4000-8000-000000000002";
  const sandbox = "00000000-0000-4000-8000-000000000003";
  try {
    expect(
      (await applyNeonMigrations(db, { log: () => {}, warn: () => {} })).ok
    ).toBe(true);
    await db.query("insert into profiles(id) values ($1),($2)", [owner, other]);
    for (const [user, model, metadata] of [
      [owner, "native", { sandbox_id: sandbox }],
      [
        owner,
        "harness",
        { sandbox_record_id: sandbox, sandbox_id: "provider-id" },
      ],
      [other, "foreign", { sandbox_id: sandbox }],
      [owner, "other-sandbox", { sandbox_id: other }],
      [
        owner,
        "explicit-other",
        { sandbox_record_id: other, sandbox_id: sandbox },
      ],
    ])
      await db.query(
        "insert into ai_calls(user_id,type,model,status,metadata) values ($1,'chat',$2,'success',$3)",
        [user, model, metadata]
      );
    const client = createPostgrestShim({
      query: async (sql, values) => ({
        rows: (await db.query<Record<string, unknown>>(sql, values ?? [])).rows,
      }),
    });
    Object.defineProperty(supabaseAdmin, "from", {
      configurable: true,
      value: client.from.bind(client),
    });
    const handler = createObservabilityCallsGetHandler({
      requireUserId: async () => owner,
    });
    const response = await handler(
      new NextRequest(
        `http://localhost/api/observability/calls?sandbox_record_id=${sandbox}`
      )
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(
      body.calls.map((call: { model: string }) => call.model).sort()
    ).toEqual(["harness", "native"]);
    expect(body.total).toBe(2);
    const params = new URLSearchParams({
      sandbox_record_id: 'x",metadata->>sandbox_record_id.not.is.null',
    });
    const escaped = await handler(
      new NextRequest(`http://localhost/api/observability/calls?${params}`)
    );
    expect(escaped.status).toBe(400);
  } finally {
    if (original) Object.defineProperty(supabaseAdmin, "from", original);
    else Reflect.deleteProperty(supabaseAdmin, "from");
    await db.close();
  }
}, 60_000);
