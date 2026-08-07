import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  assertNumEq,
  createTestDb,
  type Db,
  MODELS,
  seedModels,
  truncateAll,
} from "./harness";
import { insertCall } from "./helpers/ai-calls-cost-trigger-fixtures";

let db: Db;

beforeAll(async () => {
  db = await createTestDb();
}, 30_000);

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await truncateAll(db);
  await seedModels(db);
});

describe("rollup_job_run_cost trigger", () => {
  async function newJobRun(): Promise<string> {
    const r = await db.query<{ id: string }>(
      "INSERT INTO job_runs DEFAULT VALUES RETURNING id"
    );
    return r.rows[0]!.id;
  }

  it("sums ai_calls.cost_usd into job_runs.cost_usd", async () => {
    const m = MODELS.sonnet;
    const jobRunId = await newJobRun();
    await insertCall(db, {
      model: m.id,
      job_run_id: jobRunId,
      input_tokens: 1_000,
      output_tokens: 500,
    });
    await insertCall(db, {
      model: m.id,
      job_run_id: jobRunId,
      input_tokens: 2_000,
      output_tokens: 1_000,
    });

    const r = await db.query<{ cost_usd: string | null }>(
      "SELECT cost_usd FROM job_runs WHERE id = $1",
      [jobRunId]
    );
    const expected = 3_000 * m.pricing_input + 1_500 * m.pricing_output;
    assertNumEq(r.rows[0]!.cost_usd, expected, 1e-7);
  });

  it("updates job_runs.cost_usd when an ai_call cost changes (e.g. reconciliation)", async () => {
    const m = MODELS.sonnet;
    const jobRunId = await newJobRun();
    const call = await insertCall(db, {
      model: m.id,
      job_run_id: jobRunId,
      input_tokens: 1_000,
      output_tokens: 500,
    });
    const before = await db.query<{ cost_usd: string | null }>(
      "SELECT cost_usd FROM job_runs WHERE id = $1",
      [jobRunId]
    );
    const beforeExpected = 1_000 * m.pricing_input + 500 * m.pricing_output;
    assertNumEq(before.rows[0]!.cost_usd, beforeExpected, 1e-7);

    await db.query(
      "UPDATE ai_calls SET cost_usd = $2, cost_source = 'gateway', gateway_generation_id = $3 WHERE id = $1",
      [call.id, 0.5, "gen_reconcile"]
    );
    const after = await db.query<{ cost_usd: string | null }>(
      "SELECT cost_usd FROM job_runs WHERE id = $1",
      [jobRunId]
    );
    assertNumEq(after.rows[0]!.cost_usd, 0.5, 1e-7);
  });

  it("treats NULL cost_usd as 0 in the sum (does not blow up the rollup)", async () => {
    const m = MODELS.sonnet;
    const jobRunId = await newJobRun();
    await insertCall(db, {
      model: m.id,
      job_run_id: jobRunId,
      input_tokens: 1_000,
      output_tokens: 500,
    });
    await insertCall(db, {
      model: MODELS.unpriced.id,
      job_run_id: jobRunId,
      input_tokens: 5_000,
      output_tokens: 2_000,
    });

    const r = await db.query<{ cost_usd: string | null }>(
      "SELECT cost_usd FROM job_runs WHERE id = $1",
      [jobRunId]
    );
    const expected = 1_000 * m.pricing_input + 500 * m.pricing_output;
    assertNumEq(r.rows[0]!.cost_usd, expected, 1e-7);
  });
});

describe("migration ordering invariants", () => {
  it("trg_ai_calls_cost fires BEFORE trg_ai_calls_zz_gateway_guard", async () => {
    const r = await db.query<{ tgname: string }>(`
      SELECT tgname
        FROM pg_trigger
       WHERE tgrelid = 'ai_calls'::regclass
         AND NOT tgisinternal
         AND (tgtype::INTEGER & 2) = 2
         AND (tgtype::INTEGER & 1) = 1
       ORDER BY tgname
    `);
    const names = r.rows.map((row) => row.tgname);
    const cost = names.indexOf("trg_ai_calls_cost");
    const guard = names.indexOf("trg_ai_calls_zz_gateway_guard");
    expect(cost).toBeGreaterThanOrEqual(0);
    expect(guard).toBeGreaterThanOrEqual(0);
    expect(cost).toBeLessThan(guard);
  });

  it("idx_ai_calls_needs_reconcile exists and is a partial index", async () => {
    const r = await db.query<{ indexdef: string }>(
      "SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_ai_calls_needs_reconcile'"
    );
    expect(r.rows.length).toBe(1);
    const def = r.rows[0]!.indexdef;
    expect(def).toMatch(/WHERE /);
    expect(def).toMatch(/gateway_generation_id IS NOT NULL/);
    expect(def).toMatch(/cost_source IS DISTINCT FROM 'gateway'/);
  });
});
