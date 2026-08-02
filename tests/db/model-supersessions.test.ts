import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, test } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const MIGRATIONS = [
  "supabase/migrations/20260725120000_model_supersessions.sql",
  "supabase/migrations/20260725160000_supersession_allowlist_guard.sql",
  "supabase/migrations/20260725180000_supersession_effective_view.sql",
  "supabase/migrations/20260725220000_supersession_lost_update_fix.sql",
  "supabase/migrations/20260725240000_supersession_retraction.sql",
  "supabase/migrations/20260725260000_supersession_no_timestamp_bump.sql",
  "supabase/migrations/20260725300000_supersession_reconciler_early_exit.sql",
];

// Minimal schema for the tables upgrade_deprecated_model_pins() touches. As
// with the cost-trigger harness, we don't apply the full migration chain —
// most of it references auth.users and unrelated tables the function never
// reads. `auth.role()` is stubbed because the migration's RLS policy
// references it and Postgres resolves the expression at CREATE POLICY time.
const BOOTSTRAP_SCHEMA = /* sql */ `
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL AS $$ SELECT 'service_role'::text $$;

  -- Supabase provisions these; a bare pglite instance does not, and the
  -- migration's REVOKE/GRANT statements name them.
  CREATE ROLE anon;
  CREATE ROLE authenticated;
  CREATE ROLE service_role;

  CREATE TABLE ai_models (
    id TEXT PRIMARY KEY,
    is_available BOOLEAN NOT NULL DEFAULT true,
    is_hidden BOOLEAN DEFAULT false
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

const DEPRECATED = "anthropic/claude-opus-4.7";
const SUCCESSOR = "anthropic/claude-opus-5";

type Db = PGlite;

function agentNode(id: string, modelOverride: string | null) {
  return { id, type: "agent", data: { label: id, modelOverride } };
}

async function createDb(): Promise<Db> {
  const db = await PGlite.create();
  await db.exec(BOOTSTRAP_SCHEMA);
  for (const migration of MIGRATIONS) {
    await db.exec(await readFile(path.join(REPO_ROOT, migration), "utf8"));
  }
  return db;
}

async function seedCatalog(
  db: Db,
  options: { successorAvailable?: boolean; successorHidden?: boolean } = {}
) {
  // The deprecated model is seeded retired (is_available = false, is_hidden =
  // true), which is the state the stale sweep leaves it in — a supersession only
  // applies while its deprecated model is off the menu. Seeding it as available
  // would not reflect production and, since 20260725240000, correctly takes the
  // mapping out of model_supersessions_effective.
  await db.query(
    `INSERT INTO ai_models (id, is_available, is_hidden) VALUES ($1, false, true), ($2, $3, $4)`,
    [
      DEPRECATED,
      SUCCESSOR,
      options.successorAvailable ?? true,
      options.successorHidden ?? false,
    ]
  );
  await db.query(
    `INSERT INTO model_supersessions (deprecated_model_id, successor_model_id) VALUES ($1, $2)`,
    [DEPRECATED, SUCCESSOR]
  );
}

async function seedUser(
  db: Db,
  options: { autoEnable?: boolean } = {}
): Promise<string> {
  const result = await db.query<{ id: string }>(
    `INSERT INTO profiles (auto_enable_new_models, default_model)
     VALUES ($1, $2) RETURNING id`,
    [options.autoEnable ?? true, DEPRECATED]
  );
  const userId = result.rows[0]!.id;

  await db.query(`INSERT INTO agents (user_id, model) VALUES ($1, $2)`, [
    userId,
    DEPRECATED,
  ]);
  await db.query(
    `INSERT INTO flows (user_id, draft_graph) VALUES ($1, $2::jsonb)`,
    [
      userId,
      JSON.stringify({
        nodes: [
          agentNode("agent-1", DEPRECATED),
          agentNode("agent-2", "openai/gpt-5.4"),
          agentNode("agent-3", null),
          {
            id: "action-1",
            type: "action",
            data: { modelOverride: DEPRECATED },
          },
        ],
        edges: [],
      }),
    ]
  );

  return userId;
}

async function runUpgrade(db: Db) {
  const result = await db.query<{ upgrade_deprecated_model_pins: unknown }>(
    "SELECT upgrade_deprecated_model_pins()"
  );
  return result.rows[0]!.upgrade_deprecated_model_pins as Record<
    string,
    number
  >;
}

async function readState(db: Db, userId: string) {
  const flow = await db.query<{ draft_graph: { nodes: unknown[] } }>(
    "SELECT draft_graph FROM flows WHERE user_id = $1",
    [userId]
  );
  const agent = await db.query<{ model: string }>(
    "SELECT model FROM agents WHERE user_id = $1",
    [userId]
  );
  const profile = await db.query<{ default_model: string }>(
    "SELECT default_model FROM profiles WHERE id = $1",
    [userId]
  );
  return {
    nodes: flow.rows[0]!.draft_graph.nodes as Array<{
      id: string;
      type: string;
      data: { modelOverride: string | null };
    }>,
    agentModel: agent.rows[0]!.model,
    defaultModel: profile.rows[0]!.default_model,
  };
}

describe("upgrade_deprecated_model_pins", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createDb();
  });

  test("upgrades automation pins, agent base models, and default models", async () => {
    await seedCatalog(db);
    const userId = await seedUser(db);

    const counts = await runUpgrade(db);
    expect(counts).toEqual({ flows: 1, agents: 1, profiles: 1 });

    const state = await readState(db, userId);
    expect(state.agentModel).toBe(SUCCESSOR);
    expect(state.defaultModel).toBe(SUCCESSOR);

    // Only the agent node pinned to the deprecated model moves; node order,
    // unrelated overrides, nulls, and non-agent nodes are all preserved.
    expect(state.nodes.map((node) => node.id)).toEqual([
      "agent-1",
      "agent-2",
      "agent-3",
      "action-1",
    ]);
    expect(state.nodes[0]!.data.modelOverride).toBe(SUCCESSOR);
    expect(state.nodes[1]!.data.modelOverride).toBe("openai/gpt-5.4");
    expect(state.nodes[2]!.data.modelOverride).toBeNull();
    expect(state.nodes[3]!.data.modelOverride).toBe(DEPRECATED);
  });

  test("is idempotent — a second run upgrades nothing", async () => {
    await seedCatalog(db);
    await seedUser(db);

    await runUpgrade(db);
    expect(await runUpgrade(db)).toEqual({
      flows: 0,
      agents: 0,
      profiles: 0,
    });
  });

  test("leaves users who turned auto-enable off untouched", async () => {
    await seedCatalog(db);
    const userId = await seedUser(db, { autoEnable: false });

    expect(await runUpgrade(db)).toEqual({
      flows: 0,
      agents: 0,
      profiles: 0,
    });

    const state = await readState(db, userId);
    expect(state.agentModel).toBe(DEPRECATED);
    expect(state.defaultModel).toBe(DEPRECATED);
    expect(state.nodes[0]!.data.modelOverride).toBe(DEPRECATED);
  });

  test("never upgrades onto a successor the user explicitly disabled", async () => {
    await seedCatalog(db);
    const userId = await seedUser(db);
    await db.query(
      `INSERT INTO user_model_preferences (user_id, model_id, is_enabled)
       VALUES ($1, $2, false)`,
      [userId, SUCCESSOR]
    );

    expect(await runUpgrade(db)).toEqual({
      flows: 0,
      agents: 0,
      profiles: 0,
    });
    expect((await readState(db, userId)).agentModel).toBe(DEPRECATED);
  });

  test("never upgrades onto a successor the catalog is not offering", async () => {
    // Fail-safe: a mapping whose successor was retired or hidden must not move
    // a working pin onto a model that cannot be invoked.
    await seedCatalog(db, { successorAvailable: false });
    const userId = await seedUser(db);

    expect(await runUpgrade(db)).toEqual({
      flows: 0,
      agents: 0,
      profiles: 0,
    });
    expect((await readState(db, userId)).agentModel).toBe(DEPRECATED);
  });

  test("upgrades one user while respecting another's opt-out", async () => {
    await seedCatalog(db);
    const optedIn = await seedUser(db);
    const optedOut = await seedUser(db, { autoEnable: false });

    expect(await runUpgrade(db)).toEqual({
      flows: 1,
      agents: 1,
      profiles: 1,
    });

    expect((await readState(db, optedIn)).agentModel).toBe(SUCCESSOR);
    expect((await readState(db, optedOut)).agentModel).toBe(DEPRECATED);
  });

  test("tolerates a flow whose graph has no nodes array", async () => {
    await seedCatalog(db);
    const result = await db.query<{ id: string }>(
      `INSERT INTO profiles (auto_enable_new_models) VALUES (true) RETURNING id`
    );
    const userId = result.rows[0]!.id;
    await db.query(
      `INSERT INTO flows (user_id, draft_graph) VALUES ($1, '{}'::jsonb)`,
      [userId]
    );

    expect(await runUpgrade(db)).toEqual({
      flows: 0,
      agents: 0,
      profiles: 0,
    });
  });

  test("withholds the upgrade when a team allowlist permits the pin but not the successor", async () => {
    // Governance: silently swapping in a model the team never permitted would
    // convert a working run into MODEL_NOT_IN_ALLOWLIST_ERROR.
    await seedCatalog(db);
    const userId = await seedUser(db);
    const team = await db.query<{ id: string }>(
      `INSERT INTO teams (model_allowlist) VALUES (ARRAY[$1]::text[]) RETURNING id`,
      [DEPRECATED]
    );
    await db.query(
      `INSERT INTO team_members (team_id, user_id) VALUES ($1, $2)`,
      [team.rows[0]!.id, userId]
    );

    expect(await runUpgrade(db)).toEqual({
      flows: 0,
      agents: 0,
      profiles: 0,
    });
    expect((await readState(db, userId)).agentModel).toBe(DEPRECATED);
  });

  test("still upgrades when the team allowlist permits the successor", async () => {
    await seedCatalog(db);
    const userId = await seedUser(db);
    const team = await db.query<{ id: string }>(
      `INSERT INTO teams (model_allowlist) VALUES (ARRAY[$1, $2]::text[]) RETURNING id`,
      [DEPRECATED, SUCCESSOR]
    );
    await db.query(
      `INSERT INTO team_members (team_id, user_id) VALUES ($1, $2)`,
      [team.rows[0]!.id, userId]
    );

    expect(await runUpgrade(db)).toEqual({
      flows: 1,
      agents: 1,
      profiles: 1,
    });
    expect((await readState(db, userId)).agentModel).toBe(SUCCESSOR);
  });

  test("still upgrades when the allowlist never permitted the deprecated pin", async () => {
    // That pin is already unusable for the team, so upgrading cannot regress
    // anything — and it fixes the owner's solo scope.
    await seedCatalog(db);
    const userId = await seedUser(db);
    const team = await db.query<{ id: string }>(
      `INSERT INTO teams (model_allowlist) VALUES (ARRAY['openai/gpt-5.4']::text[]) RETURNING id`
    );
    await db.query(
      `INSERT INTO team_members (team_id, user_id) VALUES ($1, $2)`,
      [team.rows[0]!.id, userId]
    );

    expect(await runUpgrade(db)).toEqual({
      flows: 1,
      agents: 1,
      profiles: 1,
    });
    expect((await readState(db, userId)).agentModel).toBe(SUCCESSOR);
  });

  test("upgrades a user in a team with no allowlist (unrestricted)", async () => {
    await seedCatalog(db);
    const userId = await seedUser(db);
    const team = await db.query<{ id: string }>(
      `INSERT INTO teams (model_allowlist) VALUES (NULL) RETURNING id`
    );
    await db.query(
      `INSERT INTO team_members (team_id, user_id) VALUES ($1, $2)`,
      [team.rows[0]!.id, userId]
    );

    expect(await runUpgrade(db)).toEqual({
      flows: 1,
      agents: 1,
      profiles: 1,
    });
  });

  test("can be called twice in one transaction", async () => {
    // The temp table is dropped on entry as well as exit, so a retry inside an
    // open transaction does not fail on CREATE.
    await seedCatalog(db);
    await seedUser(db);

    await db.exec("BEGIN");
    await runUpgrade(db);
    await runUpgrade(db);
    await db.exec("COMMIT");
  });

  test("model_supersessions_effective hides a successor that is not offered", async () => {
    // The runtime resolver reads this view instead of the raw table, so the
    // availability guard holds on the published-automation path too.
    await seedCatalog(db, { successorAvailable: false });

    const raw = await db.query(
      "SELECT count(*)::int AS n FROM model_supersessions"
    );
    const effective = await db.query(
      "SELECT count(*)::int AS n FROM model_supersessions_effective"
    );

    expect((raw.rows[0] as { n: number }).n).toBe(1);
    expect((effective.rows[0] as { n: number }).n).toBe(0);
  });

  test("model_supersessions_effective exposes an offered successor", async () => {
    await seedCatalog(db);

    const effective = await db.query<{
      deprecated_model_id: string;
      successor_model_id: string;
    }>(
      "SELECT deprecated_model_id, successor_model_id FROM model_supersessions_effective"
    );

    expect(effective.rows).toEqual([
      { deprecated_model_id: DEPRECATED, successor_model_id: SUCCESSOR },
    ]);
  });

  test("rewrite is computed from the row, not a stale snapshot", async () => {
    // Regression guard for the lost-update window: the rewrite must be derived
    // from the row the UPDATE locks. Here the graph is mutated (a node added)
    // after the supersession mapping exists but before the reconcile runs; the
    // added node must survive and the pin must still move.
    await seedCatalog(db);
    const userId = await seedUser(db);

    await db.query(
      `UPDATE flows
       SET draft_graph = jsonb_set(
             draft_graph,
             '{nodes}',
             (draft_graph->'nodes') || $2::jsonb
           )
       WHERE user_id = $1`,
      [
        userId,
        JSON.stringify([
          { id: "agent-late", type: "agent", data: { modelOverride: null } },
        ]),
      ]
    );

    expect(await runUpgrade(db)).toEqual({
      flows: 1,
      agents: 1,
      profiles: 1,
    });

    const state = await readState(db, userId);
    // The concurrently-added node is still present...
    expect(state.nodes.map((node) => node.id)).toEqual([
      "agent-1",
      "agent-2",
      "agent-3",
      "action-1",
      "agent-late",
    ]);
    // ...and the deprecated pin was still upgraded.
    expect(state.nodes[0]!.data.modelOverride).toBe(SUCCESSOR);
  });

  test("retracts the supersession when the deprecated model returns to the catalog", async () => {
    // If pricing diverges so the old model is no longer superseded, the sync
    // writes it back as available. The stale mapping must stop applying —
    // otherwise pins on a perfectly live model keep getting moved off it.
    await seedCatalog(db);
    const userId = await seedUser(db);

    await db.query(
      `UPDATE ai_models SET is_available = true, is_hidden = false WHERE id = $1`,
      [DEPRECATED]
    );

    const effective = await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM model_supersessions_effective"
    );
    expect(effective.rows[0]!.n).toBe(0);

    expect(await runUpgrade(db)).toEqual({
      flows: 0,
      agents: 0,
      profiles: 0,
    });
    expect((await readState(db, userId)).agentModel).toBe(DEPRECATED);
  });

  test("a deprecated model absent from the catalog still counts as not offered", async () => {
    // A model superseded on its first sync is filtered out before the upsert, so
    // there is no ai_models row to compare against — absent must mean retired,
    // not "still on offer".
    await db.query(
      `INSERT INTO ai_models (id, is_available, is_hidden) VALUES ($1, true, false)`,
      [SUCCESSOR]
    );
    await db.query(
      `INSERT INTO model_supersessions (deprecated_model_id, successor_model_id)
       VALUES ($1, $2)`,
      ["anthropic/claude-opus-never-synced", SUCCESSOR]
    );

    const effective = await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM model_supersessions_effective"
    );
    expect(effective.rows[0]!.n).toBe(1);
  });

  test("does not bump flows.updated_at — the cron must not look like a user edit", async () => {
    await seedCatalog(db);
    const userId = await seedUser(db);

    const before = await db.query<{ updated_at: string }>(
      "SELECT updated_at FROM flows WHERE user_id = $1",
      [userId]
    );

    expect(await runUpgrade(db)).toEqual({
      flows: 1,
      agents: 1,
      profiles: 1,
    });

    const after = await db.query<{ updated_at: string }>(
      "SELECT updated_at FROM flows WHERE user_id = $1",
      [userId]
    );

    // Content changed...
    expect((await readState(db, userId)).nodes[0]!.data.modelOverride).toBe(
      SUCCESSOR
    );
    // ...but the timestamp did not, matching the agents/profiles statements.
    expect(after.rows[0]!.updated_at).toEqual(before.rows[0]!.updated_at);
  });

  test("is not executable by anon or authenticated, only service_role", async () => {
    // Locked in as a test rather than re-verified by hand: this is a mutating
    // RPC in the public schema, so PostgREST would expose it to any JWT if the
    // default PUBLIC grant were ever left in place.
    const acl = await db.query<{
      anon: boolean;
      authenticated: boolean;
      service_role: boolean;
    }>(
      `SELECT has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
              has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'upgrade_deprecated_model_pins'`
    );

    expect(acl.rows[0]).toEqual({
      anon: false,
      authenticated: false,
      service_role: true,
    });
  });

  test("returns early without touching flows when nothing needs upgrading", async () => {
    // Steady state on essentially every cron run. The mapping exists and its
    // successor is on offer, but no user holds a pin that needs moving.
    await seedCatalog(db);
    const profile = await db.query<{ id: string }>(
      `INSERT INTO profiles (auto_enable_new_models, default_model)
       VALUES (true, 'openai/gpt-5.4') RETURNING id`
    );
    const userId = profile.rows[0]!.id;
    await db.query(
      `INSERT INTO flows (user_id, draft_graph) VALUES ($1, $2::jsonb)`,
      [
        userId,
        JSON.stringify({
          nodes: [agentNode("agent-1", "openai/gpt-5.4")],
          edges: [],
        }),
      ]
    );

    // One user has auto-adopt on, so user_upgrades is non-empty in principle —
    // but nothing matches, so the early exit must still fire.
    expect(await runUpgrade(db)).toEqual({
      flows: 0,
      agents: 0,
      profiles: 0,
    });
  });

  test("early exit does not fire when a pin does need upgrading", async () => {
    // Guards against the early exit being too eager.
    await seedCatalog(db);
    const userId = await seedUser(db);

    expect(await runUpgrade(db)).toEqual({
      flows: 1,
      agents: 1,
      profiles: 1,
    });
    expect((await readState(db, userId)).agentModel).toBe(SUCCESSOR);
  });
});
