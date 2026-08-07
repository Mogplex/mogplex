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

describe("compute_ai_call_cost trigger", () => {
  it("returns NULL cost when no tokens are present", async () => {
    const row = await insertCall(db, { model: MODELS.sonnet.id });
    expect(row.cost_usd).toBeNull();
    expect(row.cost_source).toBe("trigger");
  });

  it("returns NULL cost when the model has no pricing row", async () => {
    const row = await insertCall(db, {
      model: MODELS.unpriced.id,
      input_tokens: 1000,
      output_tokens: 500,
    });
    expect(row.cost_usd).toBeNull();
    expect(row.cost_source).toBe("trigger");
  });

  it("applies pricing_input/pricing_output for plain in/out tokens", async () => {
    const m = MODELS.sonnet;
    const row = await insertCall(db, {
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
    const row = await insertCall(db, {
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

  it("falls back to 0.1x pricing_input for cache_read when pricing_cache_read is NULL", async () => {
    const m = MODELS.oMini;
    const row = await insertCall(db, {
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
    const row = await insertCall(db, {
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

  it("falls back to 1.25x pricing_input for cache_write when pricing_cache_write is NULL", async () => {
    const m = MODELS.oMini;
    const row = await insertCall(db, {
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
    const withReasoning = await insertCall(db, {
      model: m.id,
      input_tokens: 100,
      output_tokens: 500,
      reasoning_tokens: 9_999,
    });
    const withoutReasoning = await insertCall(db, {
      model: m.id,
      input_tokens: 100,
      output_tokens: 500,
    });
    expect(withReasoning.cost_usd).toEqual(withoutReasoning.cost_usd);
  });

  it("sets cost_source=trigger on insert when caller did not specify", async () => {
    const row = await insertCall(db, {
      model: MODELS.sonnet.id,
      input_tokens: 10,
      output_tokens: 5,
    });
    expect(row.cost_source).toBe("trigger");
  });
});
