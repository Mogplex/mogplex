import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { vector } from "@electric-sql/pglite/vector";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getUserConnections,
  updateConnection,
} from "@/lib/connections/service";
import { applyNeonMigrations } from "@/lib/db/neon-migrations";
import { SHIM_TYPE_PARSERS } from "@/lib/db/pool";
import { createPostgrestShim } from "@/lib/db/postgrest-shim";
import { supabaseAdmin } from "@/lib/supabase/admin";

const owner = "00000000-0000-4000-8000-000000000160";
const connection = "00000000-0000-4000-8000-000000000161";

let db: PGlite;
const previous = new Map<string, PropertyDescriptor | undefined>();

describe("connections.approval_mode against the migrated schema", () => {
  beforeAll(async () => {
    db = await PGlite.create({
      extensions: { vector, pg_trgm, pgcrypto, uuid_ossp },
      parsers: SHIM_TYPE_PARSERS,
    });
    expect(
      (await applyNeonMigrations(db, { log: () => {}, warn: () => {} })).ok
    ).toBe(true);

    await db.query("insert into profiles(id) values ($1)", [owner]);
    // The column list a release from before this migration writes: it has
    // never heard of approval_mode, so the default has to carry the row.
    await db.query(
      `insert into connections(id, user_id, name, type, auth_type, mcp_transport, source_preset)
       values ($1, $2, 'Trigger.dev', 'mcp_server', 'bearer', 'stdio', 'trigger')`,
      [connection, owner]
    );

    const shim = createPostgrestShim({
      query: async (sql, values) => ({
        rows: (await db.query<Record<string, unknown>>(sql, values ?? [])).rows,
      }),
    });
    for (const key of ["from", "rpc"] as const) {
      previous.set(key, Object.getOwnPropertyDescriptor(supabaseAdmin, key));
      Object.defineProperty(supabaseAdmin, key, {
        configurable: true,
        value: shim[key].bind(shim),
      });
    }
  }, 120_000);

  afterAll(async () => {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(supabaseAdmin, key, descriptor);
      else Reflect.deleteProperty(supabaseAdmin, key);
    }
    await db.close();
  });

  it("should default a connection written without the column to auto", async () => {
    const [row] = await getUserConnections(owner);

    expect(row.id).toBe(connection);
    expect(row.approval_mode).toBe("auto");
  });

  it("should persist ask through the service and read it back", async () => {
    await updateConnection(connection, { approval_mode: "ask" });

    const [row] = await getUserConnections(owner);
    expect(row.approval_mode).toBe("ask");

    await updateConnection(connection, { approval_mode: "auto" });
    const [reverted] = await getUserConnections(owner);
    expect(reverted.approval_mode).toBe("auto");
  });

  it("should reject a mode the application does not know", async () => {
    await expect(
      db.query(
        "update connections set approval_mode = 'always' where id = $1",
        [connection]
      )
    ).rejects.toThrow(/connections_approval_mode_check/);
  });
});
