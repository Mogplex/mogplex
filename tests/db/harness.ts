import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { expect } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

export const SANDBOX_BILLING_SANDBOX_STUB_SQL = /* sql */ `
  create table public.sandboxes (
    id uuid primary key,
    user_id uuid not null,
    actor_user_id uuid,
    product_team_id uuid,
    sandbox_id text not null,
    billing_source text,
    status text not null default 'stopped',
    last_active_at timestamptz not null default now()
  )
`;

export const BILLING_JOB_RUN_STUB_SQL = /* sql */ `
  create table if not exists public.job_runs (
    id uuid primary key,
    status text not null default 'pending',
    started_at timestamptz,
    completed_at timestamptz,
    duration_ms integer,
    input_tokens integer,
    output_tokens integer,
    error text,
    runtime_provider text,
    runtime_run_id text,
    workflow_run_id text,
    cancel_reason text,
    cancelled_at timestamptz
  )
`;

// Minimal schema for the tables the cost trigger battery exercises.
//
// We intentionally don't apply the full Supabase migration chain — most of it
// references auth.users, RLS policies, and unrelated tables that the triggers
// under test never touch. The cost trigger reads only ai_models and writes
// only ai_calls/job_runs, so re-creating just those three keeps the harness
// fast and resilient to drift in other migrations.
//
// NOTE: columns added by the cost migrations are intentionally absent here —
// on `ai_calls`: cost_usd, cost_source, gateway_generation_id,
// cache_read_input_tokens, cache_creation_input_tokens, reasoning_tokens;
// on `ai_models`: pricing_cache_read, pricing_cache_write. Each migration
// adds them via `ALTER TABLE … ADD COLUMN IF NOT EXISTS`. Do not "complete"
// the bootstrap by adding them here — that would change the column-creation
// order relative to the migration that owns them and could mask a real
// drift bug.
const BOOTSTRAP_SCHEMA = /* sql */ `
  CREATE TABLE ai_models (
    id TEXT PRIMARY KEY,
    pricing_input NUMERIC,
    pricing_output NUMERIC
  );

  CREATE TABLE job_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid()
  );

  CREATE TABLE ai_calls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    model TEXT NOT NULL,
    input_tokens INT,
    output_tokens INT,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    job_run_id UUID
  );
`;

// Cost-trigger migrations applied in order. The cost_usd column on ai_calls
// and job_runs is added by the first one; cost_accuracy_v2 adds token-class
// columns and rewrites compute_ai_call_cost; the gateway guard caps it off.
const COST_MIGRATIONS = [
  "supabase/migrations/20260421180000_cost_usd.sql",
  "supabase/migrations/20260516120000_cost_accuracy_v2.sql",
  "supabase/migrations/20260516130000_cost_accuracy_v2_gateway_guard.sql",
];

export type Db = PGlite;

// Columns the test battery is allowed to set on ai_calls. Keeping this as a
// closed shape (vs `Record<string, unknown>`) lets TypeScript reject typos
// like `modle: m.id` at the call site, which is the failure mode the cost
// trigger battery would otherwise surface only as a runtime Postgres error.
// Values stay loose because some tests deliberately exercise the trigger
// with values the schema would normally reject.
export type AiCallInsert = {
  model?: string;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  reasoning_tokens?: number | null;
  cost_usd?: number | null;
  cost_source?: string | null;
  gateway_generation_id?: string | null;
  job_run_id?: string | null;
  completed_at?: string | Date | null;
};

export async function createTestDb(): Promise<Db> {
  const db = await PGlite.create();
  await db.exec(BOOTSTRAP_SCHEMA);
  for (const rel of COST_MIGRATIONS) {
    const sql = await readFile(path.join(REPO_ROOT, rel), "utf8");
    await db.exec(sql);
  }
  return db;
}

export async function truncateAll(db: Db): Promise<void> {
  // CASCADE so dependent FK rows (none today) wouldn't block; RESTART IDENTITY
  // doesn't apply (UUID PKs) but keeps the intent explicit.
  await db.exec(
    "TRUNCATE TABLE ai_calls, job_runs, ai_models RESTART IDENTITY CASCADE;"
  );
}

export const MODELS = {
  // Anthropic-style: declares explicit cache pricing for both classes.
  sonnet: {
    id: "anthropic/claude-sonnet-4.6",
    pricing_input: 3 / 1_000_000,
    pricing_output: 15 / 1_000_000,
    pricing_cache_read: 0.3 / 1_000_000,
    pricing_cache_write: 3.75 / 1_000_000,
  },
  // Exercises the 0.1× / 1.25× fallback ratios.
  oMini: {
    id: "openai/o4-mini",
    pricing_input: 0.15 / 1_000_000,
    pricing_output: 0.6 / 1_000_000,
    pricing_cache_read: null,
    pricing_cache_write: null,
  },
  // Exercises the NULL-cost branch.
  unpriced: {
    id: "mystery/unpriced",
    pricing_input: null,
    pricing_output: null,
    pricing_cache_read: null,
    pricing_cache_write: null,
  },
} as const;

export async function seedModels(db: Db): Promise<void> {
  for (const m of Object.values(MODELS)) {
    await db.query(
      `INSERT INTO ai_models
         (id, pricing_input, pricing_output, pricing_cache_read, pricing_cache_write)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        m.id,
        m.pricing_input,
        m.pricing_output,
        m.pricing_cache_read,
        m.pricing_cache_write,
      ]
    );
  }
}

// Numeric-equality assertion for trigger output. NUMERIC columns come back as
// strings from pglite, so we coerce, then assert that |actual - expected| is
// within tolerance. The named matcher surfaces both values in the failure
// message so a failed test points at the actual diff instead of just
// "expected false to be true".
export function assertNumEq(
  actual: unknown,
  expected: number,
  tol = 1e-9
): void {
  const a =
    actual == null
      ? Number.NaN
      : typeof actual === "string"
        ? Number(actual)
        : (actual as number);
  const diff = Number.isNaN(a)
    ? Number.POSITIVE_INFINITY
    : Math.abs(a - expected);
  expect(
    diff,
    `assertNumEq: expected ${a} ≈ ${expected} (|diff|=${diff}, tol=${tol})`
  ).toBeLessThanOrEqual(tol);
}
