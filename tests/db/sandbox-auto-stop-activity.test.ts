import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { vector } from "@electric-sql/pglite/vector";
import { expect, it } from "vitest";
import { applyNeonMigrations } from "@/lib/db/neon-migrations";
import { createPostgrestShim } from "@/lib/db/postgrest-shim";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  hasActiveAiCall,
  hasAttachedSandboxClient,
  hasRunningAutomation,
  resolveCompletingSandboxAiCallId,
} from "@/lib/sandbox/auto-pause-deps";

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

it("automatic cleanup protects attached clients and active teammates on the same workspace", async () => {
  const db = await PGlite.create({
    extensions: { vector, pg_trgm, pgcrypto, uuid_ossp },
  });
  const previous = Object.getOwnPropertyDescriptor(supabaseAdmin, "from");
  try {
    expect(
      (await applyNeonMigrations(db, { log: () => {}, warn: () => {} })).ok
    ).toBe(true);
    await db.query("insert into profiles(id) values ($1),($2)", [id(1), id(2)]);
    await db.query(
      "insert into workspaces(id,user_id,owner_user_id,name) values ($1,$2,$2,'Widgets')",
      [id(5), id(1)]
    );
    await db.query(
      "insert into repos(id,user_id,owner_user_id,workspace_id,github_id,full_name,owner,name) values ($1,$2,$2,$1,1,'acme/widgets','acme','widgets')",
      [id(5), id(1)]
    );
    for (const sandbox of [id(3), id(4)])
      await db.query(
        "insert into sandboxes(id,user_id,repo_id,sandbox_id,working_branch,status) values ($1::uuid,$2,$3,$1::uuid::text,$1::uuid::text,'running')",
        [sandbox, id(1), id(5)]
      );
    const shim = createPostgrestShim({
      query: async (sql, values) => ({
        rows: (await db.query<Record<string, unknown>>(sql, values)).rows,
      }),
    });
    Object.defineProperty(supabaseAdmin, "from", {
      configurable: true,
      value: shim.from.bind(shim),
    });

    // Another sandbox's presence must not prevent this one from pausing.
    await db.query(
      "insert into sandbox_client_sessions(sandbox_record_id,user_id,tab_id,session_id) values ($1,$2,'other-tab','other-task')",
      [id(4), id(2)]
    );
    expect(await hasAttachedSandboxClient(id(3))).toBe(false);
    await db.query(
      "insert into sandbox_client_sessions(sandbox_record_id,user_id,tab_id,session_id) values ($1,$2,'teammate-tab','task')",
      [id(3), id(2)]
    );
    expect(await hasAttachedSandboxClient(id(3))).toBe(true);
    await db.query(
      "update sandbox_client_sessions set released_at=now() where sandbox_record_id=$1",
      [id(3)]
    );
    expect(await hasAttachedSandboxClient(id(3))).toBe(false);

    const input = {
      sandboxRecordId: id(3),
      sandboxId: id(3),
      excludeAiCallId: id(6),
    };
    for (const [call, user, sandbox] of [
      [id(6), id(1), id(3)],
      [id(7), id(2), id(4)],
    ]) {
      await db.query(
        "insert into ai_calls(id,user_id,type,model,status,metadata) values ($1,$2,'chat','test','streaming',$3)",
        [call, user, { sandbox_record_id: sandbox }]
      );
      await db.query(
        "insert into external_agent_runs(id,user_id,repo_id,ai_call_id,sandbox_record_id,idempotency_key,request_hash,harness,prompt,base_branch,working_branch,status) values ($1::uuid,$2,$3,$1,$4,$1::uuid::text,'hash','mogplex','task','main','main','streaming')",
        [call, user, id(5), sandbox]
      );
    }
    const completion = { ...input, aiCallId: id(6), userId: id(1) };
    expect(await resolveCompletingSandboxAiCallId(completion)).toBe(id(6));
    expect(
      await resolveCompletingSandboxAiCallId({ ...completion, aiCallId: id(9) })
    ).toBeUndefined();
    expect(await hasActiveAiCall({ ...input, excludeAiCallId: id(9) })).toBe(
      true
    );
    expect(await hasRunningAutomation(id(3), id(9))).toBe(true);
    // Same actor, another workspace must not authorize an exclusion.
    await db.query("update ai_calls set user_id=$1 where id=$2", [
      id(1),
      id(7),
    ]);
    expect(
      await resolveCompletingSandboxAiCallId({ ...completion, aiCallId: id(7) })
    ).toBeUndefined();
    await db.query("update ai_calls set user_id=$1 where id=$2", [
      id(2),
      id(7),
    ]);
    expect(await hasActiveAiCall(input)).toBe(false);
    expect(await hasRunningAutomation(id(3), id(6))).toBe(false);
    await db.query("update ai_calls set metadata=$1 where id=$2", [
      { sandbox_record_id: id(3) },
      id(7),
    ]);
    await db.query(
      "update external_agent_runs set sandbox_record_id=$1 where id=$2",
      [id(3), id(7)]
    );
    expect(
      await resolveCompletingSandboxAiCallId({ ...completion, aiCallId: id(7) })
    ).toBeUndefined();
    expect(await hasActiveAiCall(input)).toBe(true);
    expect(await hasRunningAutomation(id(3), id(6))).toBe(true);
    // The review's NULL-row concern is excluded by the migrated schema.
    const column = await db.query<{ is_nullable: string }>(
      "select is_nullable from information_schema.columns where table_schema='public' and table_name='external_agent_runs' and column_name='ai_call_id'"
    );
    expect(column.rows).toEqual([{ is_nullable: "NO" }]);
  } finally {
    if (previous) Object.defineProperty(supabaseAdmin, "from", previous);
    else Reflect.deleteProperty(supabaseAdmin, "from");
    await db.close();
  }
}, 120_000);
