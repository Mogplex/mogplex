import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const MIGRATIONS = [
  "supabase/migrations/20260725120000_model_supersessions.sql",
  "supabase/migrations/20260725160000_supersession_allowlist_guard.sql",
  "supabase/migrations/20260725180000_supersession_effective_view.sql",
  "supabase/migrations/20260725220000_supersession_lost_update_fix.sql",
  "supabase/migrations/20260725240000_supersession_retraction.sql",
  "supabase/migrations/20260725260000_supersession_no_timestamp_bump.sql",
  "supabase/migrations/20260725300000_supersession_reconciler_early_exit.sql",
];

const BOOTSTRAP_SCHEMA = /* sql */ `
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL AS $$ SELECT 'service_role'::text $$;

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

export const DEPRECATED = "anthropic/claude-opus-4.7";
export const SUCCESSOR = "anthropic/claude-opus-5";

export type Db = PGlite;

export function agentNode(id: string, modelOverride: string | null) {
  return { id, type: "agent", data: { label: id, modelOverride } };
}

export async function createSupersessionDb(): Promise<Db> {
  const db = await PGlite.create();
  await db.exec(BOOTSTRAP_SCHEMA);
  for (const migration of MIGRATIONS) {
    await db.exec(await readFile(path.join(REPO_ROOT, migration), "utf8"));
  }
  return db;
}

export async function seedCatalog(
  db: Db,
  options: { successorAvailable?: boolean; successorHidden?: boolean } = {}
) {
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

export async function seedUser(
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

export async function runUpgrade(db: Db) {
  const result = await db.query<{ upgrade_deprecated_model_pins: unknown }>(
    "SELECT upgrade_deprecated_model_pins()"
  );
  return result.rows[0]!.upgrade_deprecated_model_pins as Record<
    string,
    number
  >;
}

export async function readState(db: Db, userId: string) {
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
