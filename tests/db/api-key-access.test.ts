import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { vector } from "@electric-sql/pglite/vector";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { applyNeonMigrations } from "@/lib/db/neon-migrations";
import { SHIM_TYPE_PARSERS } from "@/lib/db/pool";
import { createPostgrestShim } from "@/lib/db/postgrest-shim";
import {
  createLoadTeamKeyAccess,
  requireKeyAllowedOn,
} from "@/lib/mogplex-api/team-key-access";

const owner = "00000000-0000-4000-8000-000000000171";
let db: PGlite;

async function insertKey(hash: string, access?: string) {
  const columns = access === undefined ? "" : ", access";
  const values = access === undefined ? "" : ", $3";
  const params = access === undefined ? [owner, hash] : [owner, hash, access];
  const result = await db.query<{ access: string }>(
    `insert into user_api_keys(user_id, name, token_hash, token_prefix${columns})
     values ($1, 'k', $2, 'mog_test'${values}) returning access`,
    params
  );
  return result.rows[0]?.access;
}

async function insertTeam(slug: string, access?: string) {
  const columns = access === undefined ? "" : ", api_key_access";
  const values = access === undefined ? "" : ", $3";
  const params = access === undefined ? [slug, owner] : [slug, owner, access];
  const result = await db.query<{ api_key_access: string }>(
    `insert into teams(name, slug, owner_user_id${columns})
     values ($1, $1, $2${values}) returning api_key_access`,
    params
  );
  return result.rows[0]?.api_key_access;
}

function loadThroughShim() {
  const shim = createPostgrestShim({
    query: async (sql, values) => ({
      rows: (await db.query(sql, values)).rows as Record<string, unknown>[],
    }),
  });
  return createLoadTeamKeyAccess(shim as unknown as SupabaseClient);
}

beforeAll(async () => {
  db = await PGlite.create({
    extensions: { vector, pg_trgm, pgcrypto, uuid_ossp },
    parsers: SHIM_TYPE_PARSERS,
  });
  expect(
    (await applyNeonMigrations(db, { log: () => {}, warn: () => {} })).ok
  ).toBe(true);
  await db.query("insert into profiles(id) values ($1)", [owner]);
}, 120_000);

afterAll(async () => {
  await db.close();
});

describe("API key access against the migrated schema", () => {
  it("should give keys an earlier release creates full access", async () => {
    await expect(insertKey("hash-default")).resolves.toBe("full");
  });

  it("should store an automations-only key", async () => {
    await expect(insertKey("hash-automations", "automations")).resolves.toBe(
      "automations"
    );
  });

  it("should reject an unknown key access", async () => {
    await expect(insertKey("hash-bad", "admin")).rejects.toThrow(/access/);
  });

  it("should give teams an earlier release creates full key access", async () => {
    await expect(insertTeam("team-default")).resolves.toBe("full");
  });

  it("should store a team that holds keys to automations", async () => {
    await expect(insertTeam("team-automations", "automations")).resolves.toBe(
      "automations"
    );
  });

  it("should reject an unknown team key access", async () => {
    await expect(insertTeam("team-bad", "none")).rejects.toThrow(
      /api_key_access/
    );
  });
});

describe("team key access lookup against the migrated schema", () => {
  const teamId = "00000000-0000-4000-8000-000000000172";
  let load: ReturnType<typeof createLoadTeamKeyAccess>;
  let automationId: string;

  beforeAll(async () => {
    await db.query(
      `insert into teams(id, name, slug, owner_user_id)
       values ($1, 'Acme', 'acme-lookup', $2)`,
      [teamId, owner]
    );
    await db.query(
      `insert into github_installations(user_id, installation_id, product_team_id)
       values ($1, 501, $2), ($1, 502, null)`,
      [owner, teamId]
    );
    const flow = await db.query<{ id: string }>(
      `insert into flows(user_id, installation_id, name)
       values ($1, 501, 'Preview builder') returning id`,
      [owner]
    );
    automationId = flow.rows[0]!.id;
    load = loadThroughShim();
  });

  it("should read a team installation's key access", async () => {
    await expect(load(owner, { installationId: 501 })).resolves.toBe("full");
    await db.query(
      "update teams set api_key_access = 'automations' where id = $1",
      [teamId]
    );
    await expect(load(owner, { installationId: 501 })).resolves.toBe(
      "automations"
    );
  });

  it("should follow an automation to its installation's team", async () => {
    await expect(load(owner, { automationId })).resolves.toBe("automations");
  });

  it("should report no team for personal work", async () => {
    await expect(load(owner, { installationId: 502 })).resolves.toBeNull();
  });

  it("should not read another account's installation", async () => {
    await expect(
      load("00000000-0000-4000-8000-000000000999", { installationId: 501 })
    ).resolves.toBeNull();
  });
});

describe("a team key policy change applies to the key's next request", () => {
  const teamId = "00000000-0000-4000-8000-000000000173";
  const fullKey = {
    userId: owner,
    credentialKind: "integration",
    keyAccess: "full",
  } as const;
  const target = { installationId: 503 };

  async function setTeamAccess(access: "full" | "automations") {
    await db.query("update teams set api_key_access = $1 where id = $2", [
      access,
      teamId,
    ]);
  }

  beforeAll(async () => {
    await db.query(
      `insert into teams(id, name, slug, owner_user_id)
       values ($1, 'Flip', 'flip-policy', $2)`,
      [teamId, owner]
    );
    await db.query(
      `insert into github_installations(user_id, installation_id, product_team_id)
       values ($1, 503, $2)`,
      [owner, teamId]
    );
  });

  it("should refuse a full key once the owner holds keys to automations and allow it once they lift it", async () => {
    const load = loadThroughShim();
    await expect(
      requireKeyAllowedOn(fullKey, target, load)
    ).resolves.toBeNull();

    await setTeamAccess("automations");
    const refusal = await requireKeyAllowedOn(fullKey, target, load);
    expect(refusal?.status).toBe(403);
    expect((await refusal?.json())?.error.code).toBe("AUTOMATION_REQUIRED");

    await setTeamAccess("full");
    await expect(
      requireKeyAllowedOn(fullKey, target, load)
    ).resolves.toBeNull();
  });

  it("should never hold an interactive login to automations", async () => {
    await setTeamAccess("automations");
    await expect(
      requireKeyAllowedOn(
        { userId: owner, credentialKind: "interactive", keyAccess: null },
        target,
        loadThroughShim()
      )
    ).resolves.toBeNull();
  });
});
