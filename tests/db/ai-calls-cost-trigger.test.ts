import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  type AiCallInsert,
  type Db,
  MODELS,
  assertNumEq,
  createTestDb,
  seedModels,
  truncateAll,
} from "./harness";

// Single shared db for the suite. Each test starts from a fresh, truncated
// state and seeds its own fixtures, so order-of-execution doesn't matter and
// the harness can run under parallel shards if a future runner shards by file.
let db: Db;

beforeAll(async () => {
  db = await createTestDb();
  // WASM pglite init + applying the three cost migrations is the only slow
  // step in this suite (~1–2s cold). Bump the hook timeout locally instead of
  // raising the global vitest timeout, which would also slacken `lib/**`.
}, 30_000);

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await truncateAll(db);
  await seedModels(db);
});

async function insertCall(row: AiCallInsert): Promise<Record<string, unknown>> {
  const cols = Object.keys(row) as (keyof AiCallInsert)[];
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
  const result = await db.query<Record<string, unknown>>(
    `INSERT INTO ai_calls (${cols.join(", ")}) VALUES (${placeholders}) RETURNING *`,
    cols.map((c) => row[c])
  );
  return result.rows[0]!;
}

async function selectCall(id: string): Promise<Record<string, unknown>> {
  const r = await db.query<Record<string, unknown>>(
    "SELECT * FROM ai_calls WHERE id = $1",
    [id]
  );
  const row = r.rows[0];
  if (!row) throw new Error(`selectCall: no ai_calls row for id=${id}`);
  return row;
}

// Both reject helpers must only accept the specific PL/pgSQL `RAISE EXCEPTION`
// emitted by the guard. Without the SQLSTATE check, an unrelated infra error
// (column typo, syntax error, broken setup) whose message happened to match the
// pattern would pass vacuously — masking a real guard regression. The cost
// migrations all `RAISE EXCEPTION` without ERRCODE, so the SQLSTATE is P0001
// (raise_exception). Anything else is re-thrown so the test fails with the
// real cause instead of silently going green.
//
// Shape contract — verified at runtime: @electric-sql/pglite v0.4.5 throws a
// `DatabaseError extends Error` with `.code` set directly on the instance
// (see node_modules/@electric-sql/pglite/dist/index.d.ts:128). If pglite ever
// reshaped this — e.g. nesting under `.fields.code` — every reject-path test
// would fail noisily on the next upgrade rather than silently passing, because
// `undefined !== 'P0001'` re-throws the original error to the runner. The 6
// reject tests in this file collectively prove the contract still holds.
//
// Propagation contract: the `expect(...)` below throws a Vitest `AssertionError`
// when the message doesn't match. That AssertionError is *intentionally* allowed
// to propagate to the runner — it is not a `DatabaseError`, so re-entering this
// helper (e.g. via a future wrapper that catches everything) would re-throw it
// rather than swallow it. Do not wrap this call in a try/catch that absorbs
// assertion errors.
function assertPgRaise(err: unknown, pattern: RegExp): void {
  if (!(err instanceof Error) || (err as { code?: string }).code !== "P0001") {
    throw err;
  }
  expect(err.message).toMatch(pattern);
}

async function expectInsertRejected(
  row: AiCallInsert,
  pattern: RegExp
): Promise<void> {
  try {
    await insertCall(row);
  } catch (e) {
    assertPgRaise(e, pattern);
    return;
  }
  throw new Error("expected insert to be rejected");
}

async function expectUpdateRejected(
  id: string,
  set: AiCallInsert,
  pattern: RegExp
): Promise<void> {
  const cols = Object.keys(set) as (keyof AiCallInsert)[];
  const assignments = cols.map((c, i) => `${c} = $${i + 2}`).join(", ");
  try {
    await db.query(`UPDATE ai_calls SET ${assignments} WHERE id = $1`, [
      id,
      ...cols.map((c) => set[c]),
    ]);
  } catch (e) {
    assertPgRaise(e, pattern);
    return;
  }
  throw new Error("expected update to be rejected");
}

describe("compute_ai_call_cost trigger", () => {
  it("returns NULL cost when no tokens are present", async () => {
    const row = await insertCall({ model: MODELS.sonnet.id });
    expect(row.cost_usd).toBeNull();
    // Migration #520 case 10: formula-owned row with no tokens still stamps
    // cost_source = 'trigger'.
    expect(row.cost_source).toBe("trigger");
  });

  it("returns NULL cost when the model has no pricing row", async () => {
    const row = await insertCall({
      model: MODELS.unpriced.id,
      input_tokens: 1000,
      output_tokens: 500,
    });
    expect(row.cost_usd).toBeNull();
    expect(row.cost_source).toBe("trigger");
  });

  it("applies pricing_input/pricing_output for plain in/out tokens", async () => {
    const m = MODELS.sonnet;
    const row = await insertCall({
      model: m.id,
      input_tokens: 1_000,
      output_tokens: 500,
    });
    const expected = 1_000 * m.pricing_input + 500 * m.pricing_output;
    assertNumEq(row.cost_usd, expected);
    expect(row.cost_source).toBe("trigger");
  });

  it("applies pricing_cache_read when the model declares it", async () => {
    const m = MODELS.sonnet;
    const row = await insertCall({
      model: m.id,
      input_tokens: 100,
      cache_read_input_tokens: 800,
      output_tokens: 200,
    });
    const expected =
      100 * m.pricing_input +
      800 * m.pricing_cache_read +
      200 * m.pricing_output;
    assertNumEq(row.cost_usd, expected);
    expect(row.cost_source).toBe("trigger");
  });

  it("falls back to 0.1× pricing_input for cache_read when pricing_cache_read is NULL", async () => {
    const m = MODELS.oMini;
    const row = await insertCall({
      model: m.id,
      input_tokens: 100,
      cache_read_input_tokens: 1_000,
      output_tokens: 200,
    });
    const expected =
      100 * m.pricing_input +
      1_000 * (m.pricing_input * 0.1) +
      200 * m.pricing_output;
    assertNumEq(row.cost_usd, expected);
    expect(row.cost_source).toBe("trigger");
  });

  it("applies pricing_cache_write when the model declares it", async () => {
    const m = MODELS.sonnet;
    const row = await insertCall({
      model: m.id,
      input_tokens: 100,
      cache_creation_input_tokens: 400,
      output_tokens: 200,
    });
    const expected =
      100 * m.pricing_input +
      400 * m.pricing_cache_write +
      200 * m.pricing_output;
    assertNumEq(row.cost_usd, expected);
    expect(row.cost_source).toBe("trigger");
  });

  it("falls back to 1.25× pricing_input for cache_write when pricing_cache_write is NULL", async () => {
    const m = MODELS.oMini;
    const row = await insertCall({
      model: m.id,
      input_tokens: 100,
      cache_creation_input_tokens: 400,
      output_tokens: 200,
    });
    const expected =
      100 * m.pricing_input +
      400 * (m.pricing_input * 1.25) +
      200 * m.pricing_output;
    assertNumEq(row.cost_usd, expected);
    expect(row.cost_source).toBe("trigger");
  });

  it("does NOT charge for reasoning_tokens (they ride inside output_tokens)", async () => {
    const m = MODELS.sonnet;
    const withReasoning = await insertCall({
      model: m.id,
      input_tokens: 100,
      output_tokens: 500,
      reasoning_tokens: 9_999,
    });
    const withoutReasoning = await insertCall({
      model: m.id,
      input_tokens: 100,
      output_tokens: 500,
    });
    expect(withReasoning.cost_usd).toEqual(withoutReasoning.cost_usd);
  });

  it("sets cost_source=trigger on insert when caller did not specify", async () => {
    const row = await insertCall({
      model: MODELS.sonnet.id,
      input_tokens: 10,
      output_tokens: 5,
    });
    expect(row.cost_source).toBe("trigger");
  });
});

describe("trg_ai_calls_zz_gateway_guard (10-case verification matrix)", () => {
  it("case 1: INSERT with cost_usd requires cost_source IN (manual, gateway)", async () => {
    const ok = await insertCall({
      model: MODELS.sonnet.id,
      input_tokens: 1_000,
      output_tokens: 500,
      cost_usd: 0.123,
      cost_source: "manual",
    });
    assertNumEq(ok.cost_usd, 0.123);
    expect(ok.cost_source).toBe("manual");

    const ok2 = await insertCall({
      model: MODELS.sonnet.id,
      input_tokens: 1_000,
      output_tokens: 500,
      cost_usd: 0.456,
      cost_source: "gateway",
      gateway_generation_id: "gen_1",
    });
    assertNumEq(ok2.cost_usd, 0.456);
    expect(ok2.cost_source).toBe("gateway");
  });

  it("case 2: INSERT with cost_usd and cost_source=trigger raises", async () => {
    await expectInsertRejected(
      {
        model: MODELS.sonnet.id,
        input_tokens: 1_000,
        output_tokens: 500,
        cost_usd: 0.123,
        cost_source: "trigger",
      },
      /cost_usd is computed when cost_source is trigger or unset/
    );
    // And with NULL cost_source (defaults to trigger semantics).
    await expectInsertRejected(
      {
        model: MODELS.sonnet.id,
        input_tokens: 1_000,
        output_tokens: 500,
        cost_usd: 0.123,
      },
      /cost_usd is computed when cost_source is trigger or unset/
    );
  });

  it("case 3: INSERT without cost_usd works regardless of cost_source", async () => {
    const trigger = await insertCall({
      model: MODELS.sonnet.id,
      input_tokens: 1,
      output_tokens: 1,
    });
    expect(trigger.cost_source).toBe("trigger");

    const manual = await insertCall({
      model: MODELS.sonnet.id,
      input_tokens: 1,
      output_tokens: 1,
      cost_source: "manual",
    });
    // Manual short-circuits compute, leaving cost_usd NULL (caller chose not
    // to set one).
    expect(manual.cost_source).toBe("manual");
    expect(manual.cost_usd).toBeNull();

    const gateway = await insertCall({
      model: MODELS.sonnet.id,
      input_tokens: 1,
      output_tokens: 1,
      cost_source: "gateway",
      gateway_generation_id: "gen_x",
    });
    expect(gateway.cost_source).toBe("gateway");
    expect(gateway.cost_usd).toBeNull();
  });

  it("case 4: UPDATE of cost_usd from non-gateway → gateway is the W7 initial claim path", async () => {
    // Verification matrix case 3: initial gateway claim from a non-gateway row
    // is allowed because OLD.cost_source <> 'gateway', so the post-compute
    // guard never fires.
    const inserted = await insertCall({
      model: MODELS.sonnet.id,
      input_tokens: 1_000,
      output_tokens: 500,
    });
    expect(inserted.cost_source).toBe("trigger");

    await db.query(
      "UPDATE ai_calls SET cost_usd = $2, cost_source = $3, gateway_generation_id = $4 WHERE id = $1",
      [inserted.id, 0.999, "gateway", "gen_initial"]
    );
    const after = await selectCall(inserted.id as string);
    assertNumEq(after.cost_usd, 0.999);
    expect(after.cost_source).toBe("gateway");
    expect(after.gateway_generation_id).toBe("gen_initial");
  });

  it("case 5: UPDATE that re-states gateway with no cost_usd change is a no-op (allowed)", async () => {
    const inserted = await insertCall({
      model: MODELS.sonnet.id,
      cost_usd: 0.5,
      cost_source: "gateway",
      gateway_generation_id: "gen_a",
    });
    await db.query(
      "UPDATE ai_calls SET cost_source = 'gateway' WHERE id = $1",
      [inserted.id]
    );
    const after = await selectCall(inserted.id as string);
    assertNumEq(after.cost_usd, 0.5);
    expect(after.cost_source).toBe("gateway");
    expect(after.gateway_generation_id).toBe("gen_a");
  });

  it("case 6: UPDATE of gateway-owned cost_usd with new gateway_generation_id is allowed (W7 refresh)", async () => {
    const inserted = await insertCall({
      model: MODELS.sonnet.id,
      cost_usd: 0.5,
      cost_source: "gateway",
      gateway_generation_id: "gen_a",
    });
    await db.query(
      "UPDATE ai_calls SET cost_usd = $2, gateway_generation_id = $3 WHERE id = $1",
      [inserted.id, 0.75, "gen_b"]
    );
    const after = await selectCall(inserted.id as string);
    assertNumEq(after.cost_usd, 0.75);
    expect(after.cost_source).toBe("gateway");
    expect(after.gateway_generation_id).toBe("gen_b");
  });

  it("case 7: UPDATE of cost_usd on trigger-owned row with no pricing input change raises", async () => {
    const inserted = await insertCall({
      model: MODELS.sonnet.id,
      input_tokens: 1_000,
      output_tokens: 500,
    });
    expect(inserted.cost_source).toBe("trigger");

    await expectUpdateRejected(
      inserted.id as string,
      { cost_usd: 0.99 },
      /cost_usd is computed while cost_source=trigger/
    );

    // But an operator override that claims manual ownership succeeds.
    await db.query(
      "UPDATE ai_calls SET cost_usd = $2, cost_source = 'manual' WHERE id = $1",
      [inserted.id, 0.99]
    );
    const after = await selectCall(inserted.id as string);
    assertNumEq(after.cost_usd, 0.99);
    expect(after.cost_source).toBe("manual");
  });

  it("case 8: UPDATE of gateway-owned cost_usd without moving gateway_generation_id raises", async () => {
    const inserted = await insertCall({
      model: MODELS.sonnet.id,
      cost_usd: 0.5,
      cost_source: "gateway",
      gateway_generation_id: "gen_a",
    });

    await expectUpdateRejected(
      inserted.id as string,
      { cost_usd: 0.75 },
      /owned by gateway reconciliation/
    );
  });

  it("case 9: gateway → manual demotion preserves the caller-supplied cost_usd", async () => {
    const inserted = await insertCall({
      model: MODELS.sonnet.id,
      cost_usd: 0.5,
      cost_source: "gateway",
      gateway_generation_id: "gen_a",
    });
    await db.query(
      "UPDATE ai_calls SET cost_usd = $2, cost_source = 'manual' WHERE id = $1",
      [inserted.id, 0.77]
    );
    const after = await selectCall(inserted.id as string);
    assertNumEq(after.cost_usd, 0.77);
    expect(after.cost_source).toBe("manual");
  });

  it("case 10: gateway → trigger demotion releases ownership and recomputes from tokens", async () => {
    const m = MODELS.sonnet;
    const inserted = await insertCall({
      model: m.id,
      input_tokens: 1_000,
      output_tokens: 500,
      cost_usd: 0.99,
      cost_source: "gateway",
      gateway_generation_id: "gen_a",
    });
    // gateway short-circuits compute, so cost stays at the caller-supplied
    // value on insert.
    assertNumEq(inserted.cost_usd, 0.99);

    await db.query(
      "UPDATE ai_calls SET cost_source = 'trigger' WHERE id = $1",
      [inserted.id]
    );
    const after = await selectCall(inserted.id as string);
    const expected = 1_000 * m.pricing_input + 500 * m.pricing_output;
    assertNumEq(after.cost_usd, expected);
    expect(after.cost_source).toBe("trigger");
  });

  it("bonus: UPDATE that sets cost_source=gateway without gateway_generation_id is allowed only as initial claim", async () => {
    // Same row not yet gateway-owned: this is verification matrix case 3, and
    // explicitly succeeds — gateway_generation_id is optional on the initial
    // claim.
    const a = await insertCall({
      model: MODELS.sonnet.id,
      input_tokens: 100,
      output_tokens: 100,
    });
    await db.query(
      "UPDATE ai_calls SET cost_usd = $2, cost_source = 'gateway' WHERE id = $1",
      [a.id, 0.4]
    );
    const after = await selectCall(a.id as string);
    expect(after.cost_source).toBe("gateway");
    assertNumEq(after.cost_usd, 0.4);
  });
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
    await insertCall({
      model: m.id,
      job_run_id: jobRunId,
      input_tokens: 1_000,
      output_tokens: 500,
    });
    await insertCall({
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
    const call = await insertCall({
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

    // W7 reconciliation pattern: cost_usd, cost_source, gateway_generation_id
    // move together. The compute trigger short-circuits and the rollup picks
    // up the new value.
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
    // Priced call.
    await insertCall({
      model: m.id,
      job_run_id: jobRunId,
      input_tokens: 1_000,
      output_tokens: 500,
    });
    // Unpriced call — leaves cost_usd NULL.
    await insertCall({
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
    // pg_trigger.tgtype is a bitmask (see PostgreSQL src/include/catalog/
    // pg_trigger.h):
    //   TRIGGER_TYPE_ROW    = 0x01 (=1)  → FOR EACH ROW (vs FOR EACH STATEMENT)
    //   TRIGGER_TYPE_BEFORE = 0x02 (=2)  → BEFORE (vs AFTER)
    // Filtering on both gives only BEFORE-ROW triggers on ai_calls, which is
    // the firing class the compute → guard ordering invariant lives in.
    const r = await db.query<{ tgname: string }>(`
      SELECT tgname
        FROM pg_trigger
       WHERE tgrelid = 'ai_calls'::regclass
         AND NOT tgisinternal
         AND (tgtype::INTEGER & 2) = 2   -- BEFORE (vs AFTER / INSTEAD OF)
         AND (tgtype::INTEGER & 1) = 1   -- FOR EACH ROW (vs FOR EACH STATEMENT)
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
