import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { vector } from "@electric-sql/pglite/vector";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiKeyPatchHandler } from "@/app/api/settings/api-keys/[id]/route";
import { createApiKeysPostHandler } from "@/app/api/settings/api-keys/route";
import { lookupApiKeyAccess, resolveApiKey } from "@/lib/auth/api-key";
import { applyNeonMigrations } from "@/lib/db/neon-migrations";
import { SHIM_TYPE_PARSERS } from "@/lib/db/pool";
import { createPostgrestShim } from "@/lib/db/postgrest-shim";
import { supabaseAdmin } from "@/lib/supabase/admin";

const owner = "00000000-0000-4000-8000-000000000173";
const stranger = "00000000-0000-4000-8000-000000000174";
let db: PGlite;
const previous = new Map<string, PropertyDescriptor | undefined>();

beforeAll(async () => {
  db = await PGlite.create({
    extensions: { vector, pg_trgm, pgcrypto, uuid_ossp },
    parsers: SHIM_TYPE_PARSERS,
  });
  expect(
    (await applyNeonMigrations(db, { log: () => {}, warn: () => {} })).ok
  ).toBe(true);
  await db.query("insert into profiles(id) values ($1), ($2)", [
    owner,
    stranger,
  ]);
  const shim = createPostgrestShim({
    query: async (sql, values) => ({
      rows: (await db.query<Record<string, unknown>>(sql, values ?? [])).rows,
    }),
  });
  previous.set("from", Object.getOwnPropertyDescriptor(supabaseAdmin, "from"));
  Object.defineProperty(supabaseAdmin, "from", {
    configurable: true,
    value: shim.from.bind(shim),
  });
}, 120_000);

afterAll(async () => {
  for (const [key, descriptor] of previous) {
    if (descriptor) Object.defineProperty(supabaseAdmin, key, descriptor);
    else Reflect.deleteProperty(supabaseAdmin, key);
  }
  await db.close();
});

async function createKey(body: Record<string, unknown>) {
  const response = await createApiKeysPostHandler({
    requireUserId: async () => owner,
  })(
    new Request("https://mogplex.test/api/settings/api-keys", {
      method: "POST",
      body: JSON.stringify(body),
    })
  );
  expect(response.status).toBe(200);
  return (await response.json()) as { id: string; token: string };
}

function setAccess(userId: string, keyId: string, access: string) {
  return createApiKeyPatchHandler({ requireUserId: async () => userId })(
    new Request(`https://mogplex.test/api/settings/api-keys/${keyId}`, {
      method: "PATCH",
      body: JSON.stringify({ access }),
    }),
    { params: Promise.resolve({ id: keyId }) }
  );
}

describe("API key access stored and read through the real paths", () => {
  it("should store an automations-only key and resolve it as one", async () => {
    const key = await createKey({ name: "webrenew", access: "automations" });
    const resolved = await resolveApiKey(`Bearer ${key.token}`);
    expect(resolved).toMatchObject({
      ok: true,
      auth: { userId: owner, access: "automations" },
    });
    await expect(lookupApiKeyAccess(`Bearer ${key.token}`)).resolves.toBe(
      "automations"
    );
  });

  it("should give a key created without access full access", async () => {
    const key = await createKey({ name: "laptop" });
    await expect(lookupApiKeyAccess(`Bearer ${key.token}`)).resolves.toBe(
      "full"
    );
  });

  it("should let the owner change a key's access for its next request", async () => {
    const key = await createKey({ name: "ci", access: "full" });
    expect((await setAccess(owner, key.id, "automations")).status).toBe(200);
    await expect(lookupApiKeyAccess(`Bearer ${key.token}`)).resolves.toBe(
      "automations"
    );
  });

  it("should not let another account change the key", async () => {
    const key = await createKey({ name: "server", access: "automations" });
    expect((await setAccess(stranger, key.id, "full")).status).toBe(404);
    await expect(lookupApiKeyAccess(`Bearer ${key.token}`)).resolves.toBe(
      "automations"
    );
  });

  it("should report no access for an unknown key", async () => {
    await expect(
      lookupApiKeyAccess("Bearer mog_not_a_real_key")
    ).resolves.toBeNull();
  });
});
