import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, test } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
// Version order, i.e. the order a fresh `db reset` applies them. The backfill
// (140000) was authored after the guard/view migrations but sorts before them,
// so applying it mid-chain is what production bootstrap actually does.
const MIGRATIONS_BEFORE_BACKFILL = [
  "supabase/migrations/20260725120000_model_supersessions.sql",
];
const MIGRATIONS_AFTER_BACKFILL = [
  "supabase/migrations/20260725160000_supersession_allowlist_guard.sql",
  "supabase/migrations/20260725180000_supersession_effective_view.sql",
  "supabase/migrations/20260725220000_supersession_lost_update_fix.sql",
];
const BACKFILL_MIGRATION =
  "supabase/migrations/20260725140000_backfill_opus_supersessions.sql";

// Only the tables the two migrations read. See model-supersessions.test.ts for
// why auth.role() and the Supabase roles are stubbed.
const BOOTSTRAP_SCHEMA = /* sql */ `
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL AS $$ SELECT 'service_role'::text $$;

  CREATE ROLE anon;
  CREATE ROLE authenticated;
  CREATE ROLE service_role;

  CREATE TABLE ai_models (
    id TEXT PRIMARY KEY,
    provider TEXT,
    is_available BOOLEAN NOT NULL DEFAULT true,
    is_hidden BOOLEAN DEFAULT false,
    pricing_input NUMERIC,
    pricing_output NUMERIC
  );

  CREATE TABLE profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auto_enable_new_models BOOLEAN NOT NULL DEFAULT true,
    default_model TEXT
  );

  CREATE TABLE agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    model TEXT
  );

  CREATE TABLE flows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    draft_graph JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE teams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    model_allowlist TEXT[]
  );

  CREATE TABLE team_members (
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    PRIMARY KEY (team_id, user_id)
  );

  CREATE TABLE user_model_preferences (
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    model_id TEXT NOT NULL REFERENCES ai_models(id) ON DELETE CASCADE,
    is_enabled BOOLEAN NOT NULL,
    PRIMARY KEY (user_id, model_id)
  );
`;

const OPUS_PRICE = { input: 0.000005, output: 0.000025 };

type Db = PGlite;

// Mirrors the production catalog at the time 20260725120000 was applied: Opus 5
// live, and every earlier Opus already retired by the newest-version policy.
async function seedProductionLikeCatalog(
  db: Db,
  options: { opus5Available?: boolean; opus5Price?: typeof OPUS_PRICE } = {}
) {
  const opus5Price = options.opus5Price ?? OPUS_PRICE;
  const rows: Array<[string, boolean, boolean, number, number]> = [
    [
      "anthropic/claude-opus-4.5",
      false,
      true,
      OPUS_PRICE.input,
      OPUS_PRICE.output,
    ],
    [
      "anthropic/claude-opus-4.6",
      false,
      true,
      OPUS_PRICE.input,
      OPUS_PRICE.output,
    ],
    [
      "anthropic/claude-opus-4.7",
      false,
      true,
      OPUS_PRICE.input,
      OPUS_PRICE.output,
    ],
    [
      "anthropic/claude-opus-4.8",
      false,
      true,
      OPUS_PRICE.input,
      OPUS_PRICE.output,
    ],
    [
      "anthropic/claude-opus-5",
      options.opus5Available ?? true,
      false,
      opus5Price.input,
      opus5Price.output,
    ],
    ["anthropic/claude-sonnet-4.6", true, false, 0.000003, 0.000015],
  ];

  for (const [id, isAvailable, isHidden, input, output] of rows) {
    await db.query(
      `INSERT INTO ai_models (id, provider, is_available, is_hidden, pricing_input, pricing_output)
       VALUES ($1, 'anthropic', $2, $3, $4, $5)`,
      [id, isAvailable, isHidden, input, output]
    );
  }
}

async function applyMigrations(db: Db, migrations: string[]) {
  for (const migration of migrations) {
    await db.exec(await readFile(path.join(REPO_ROOT, migration), "utf8"));
  }
}

// Everything that precedes the backfill in version order.
async function applyBaseMigrations(db: Db) {
  await applyMigrations(db, MIGRATIONS_BEFORE_BACKFILL);
}

// The backfill, then the migrations that follow it — matching a fresh reset.
async function applyBackfill(db: Db) {
  await applyMigrations(db, [BACKFILL_MIGRATION]);
  await applyMigrations(db, MIGRATIONS_AFTER_BACKFILL);
}

async function readSupersessions(db: Db) {
  const result = await db.query<{
    deprecated_model_id: string;
    successor_model_id: string;
  }>(
    `SELECT deprecated_model_id, successor_model_id
     FROM model_supersessions ORDER BY deprecated_model_id`
  );
  return result.rows.map((row) => [
    row.deprecated_model_id,
    row.successor_model_id,
  ]);
}

// The base migration also seeds the Sonnet family (sonnet-4.6 is still live in
// these fixtures, so that half of its seed does apply). Scope assertions about
// the backfill to the Opus rows it owns.
async function readOpusSupersessions(db: Db) {
  const rows = await readSupersessions(db);
  return rows.filter(([deprecated]) =>
    deprecated.startsWith("anthropic/claude-opus-")
  );
}

describe("20260725140000 Opus supersession backfill", () => {
  let db: Db;

  beforeEach(async () => {
    db = await PGlite.create();
    await db.exec(BOOTSTRAP_SCHEMA);
  });

  test("points the whole retired Opus family at Opus 5", async () => {
    await seedProductionLikeCatalog(db);
    // The base migration's own Opus seed is skipped here exactly as it was in
    // production, because 4.8 is already retired.
    await applyBaseMigrations(db);
    expect(await readOpusSupersessions(db)).toEqual([]);

    await applyBackfill(db);

    expect(await readOpusSupersessions(db)).toEqual([
      ["anthropic/claude-opus-4.5", "anthropic/claude-opus-5"],
      ["anthropic/claude-opus-4.6", "anthropic/claude-opus-5"],
      ["anthropic/claude-opus-4.7", "anthropic/claude-opus-5"],
      ["anthropic/claude-opus-4.8", "anthropic/claude-opus-5"],
    ]);
  });

  test("advances a stored row whose successor has since been retired", async () => {
    await seedProductionLikeCatalog(db);
    await applyBaseMigrations(db);
    // Simulate an environment where 4.7 -> 4.8 was recorded while 4.8 was
    // still live; 4.8 is now retired, so the row must move on to Opus 5.
    await db.query(
      `INSERT INTO model_supersessions (deprecated_model_id, successor_model_id)
       VALUES ('anthropic/claude-opus-4.7', 'anthropic/claude-opus-4.8')`
    );

    await applyBackfill(db);

    const rows = await readSupersessions(db);
    expect(
      rows.find(([deprecated]) => deprecated === "anthropic/claude-opus-4.7")
    ).toEqual(["anthropic/claude-opus-4.7", "anthropic/claude-opus-5"]);
  });

  test("never clobbers a mapping that still points at a live model", async () => {
    await seedProductionLikeCatalog(db);
    await applyBaseMigrations(db);
    // A hand-set mapping onto a live model must survive the backfill.
    await db.query(
      `INSERT INTO model_supersessions (deprecated_model_id, successor_model_id)
       VALUES ('anthropic/claude-opus-4.6', 'anthropic/claude-sonnet-4.6')`
    );

    await applyBackfill(db);

    const rows = await readSupersessions(db);
    expect(
      rows.find(([deprecated]) => deprecated === "anthropic/claude-opus-4.6")
    ).toEqual(["anthropic/claude-opus-4.6", "anthropic/claude-sonnet-4.6"]);
  });

  test("is a no-op when Opus 5 is not being offered", async () => {
    await seedProductionLikeCatalog(db, { opus5Available: false });
    await applyBaseMigrations(db);

    await applyBackfill(db);

    expect(await readOpusSupersessions(db)).toEqual([]);
  });

  test("is a no-op when Opus 5 pricing diverged from the retired family", async () => {
    // Same-pricing is the whole justification for a silent upgrade; if Opus 5
    // were dearer, the backfill must not move anyone onto it.
    await seedProductionLikeCatalog(db, {
      opus5Price: { input: 0.00001, output: 0.00005 },
    });
    await applyBaseMigrations(db);

    await applyBackfill(db);

    expect(await readOpusSupersessions(db)).toEqual([]);
  });

  test("is idempotent", async () => {
    await seedProductionLikeCatalog(db);
    await applyBaseMigrations(db);

    await applyBackfill(db);
    const first = await readSupersessions(db);
    await applyBackfill(db);

    expect(await readSupersessions(db)).toEqual(first);
    expect(first.length).toBeGreaterThan(0);
  });

  test("upgrades a live orphaned pin once the mapping exists", async () => {
    // The concrete production case: an agent still pinned to Opus 4.6.
    await seedProductionLikeCatalog(db);
    await applyBaseMigrations(db);

    const profile = await db.query<{ id: string }>(
      `INSERT INTO profiles (auto_enable_new_models) VALUES (true) RETURNING id`
    );
    const userId = profile.rows[0]!.id;
    await db.query(`INSERT INTO agents (user_id, model) VALUES ($1, $2)`, [
      userId,
      "anthropic/claude-opus-4.6",
    ]);

    await applyBackfill(db);
    const counts = await db.query<{ upgrade_deprecated_model_pins: unknown }>(
      "SELECT upgrade_deprecated_model_pins()"
    );
    expect(counts.rows[0]!.upgrade_deprecated_model_pins).toEqual({
      flows: 0,
      agents: 1,
      profiles: 0,
    });

    const agent = await db.query<{ model: string }>(
      "SELECT model FROM agents WHERE user_id = $1",
      [userId]
    );
    expect(agent.rows[0]!.model).toBe("anthropic/claude-opus-5");
  });
});
