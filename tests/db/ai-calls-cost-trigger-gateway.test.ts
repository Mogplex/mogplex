import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  assertNumEq,
  createTestDb,
  type Db,
  MODELS,
  seedModels,
  truncateAll,
} from "./harness";
import {
  expectInsertRejected,
  expectUpdateRejected,
  insertCall,
  selectCall,
} from "./helpers/ai-calls-cost-trigger-fixtures";

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

describe("trg_ai_calls_zz_gateway_guard (10-case verification matrix)", () => {
  it("case 1: INSERT with cost_usd requires cost_source IN (manual, gateway)", async () => {
    const ok = await insertCall(db, {
      model: MODELS.sonnet.id,
      input_tokens: 1_000,
      output_tokens: 500,
      cost_usd: 0.123,
      cost_source: "manual",
    });
    assertNumEq(ok.cost_usd, 0.123);
    expect(ok.cost_source).toBe("manual");

    const ok2 = await insertCall(db, {
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
      db,
      {
        model: MODELS.sonnet.id,
        input_tokens: 1_000,
        output_tokens: 500,
        cost_usd: 0.123,
        cost_source: "trigger",
      },
      /cost_usd is computed when cost_source is trigger or unset/
    );
    await expectInsertRejected(
      db,
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
    const trigger = await insertCall(db, {
      model: MODELS.sonnet.id,
      input_tokens: 1,
      output_tokens: 1,
    });
    expect(trigger.cost_source).toBe("trigger");

    const manual = await insertCall(db, {
      model: MODELS.sonnet.id,
      input_tokens: 1,
      output_tokens: 1,
      cost_source: "manual",
    });
    expect(manual.cost_source).toBe("manual");
    expect(manual.cost_usd).toBeNull();

    const gateway = await insertCall(db, {
      model: MODELS.sonnet.id,
      input_tokens: 1,
      output_tokens: 1,
      cost_source: "gateway",
      gateway_generation_id: "gen_x",
    });
    expect(gateway.cost_source).toBe("gateway");
    expect(gateway.cost_usd).toBeNull();
  });

  it("case 4: UPDATE of cost_usd from non-gateway to gateway is the W7 initial claim path", async () => {
    const inserted = await insertCall(db, {
      model: MODELS.sonnet.id,
      input_tokens: 1_000,
      output_tokens: 500,
    });
    expect(inserted.cost_source).toBe("trigger");

    await db.query(
      "UPDATE ai_calls SET cost_usd = $2, cost_source = $3, gateway_generation_id = $4 WHERE id = $1",
      [inserted.id, 0.999, "gateway", "gen_initial"]
    );
    const after = await selectCall(db, inserted.id as string);
    assertNumEq(after.cost_usd, 0.999);
    expect(after.cost_source).toBe("gateway");
    expect(after.gateway_generation_id).toBe("gen_initial");
  });

  it("case 5: UPDATE that re-states gateway with no cost_usd change is a no-op (allowed)", async () => {
    const inserted = await insertCall(db, {
      model: MODELS.sonnet.id,
      cost_usd: 0.5,
      cost_source: "gateway",
      gateway_generation_id: "gen_a",
    });
    await db.query(
      "UPDATE ai_calls SET cost_source = 'gateway' WHERE id = $1",
      [inserted.id]
    );
    const after = await selectCall(db, inserted.id as string);
    assertNumEq(after.cost_usd, 0.5);
    expect(after.cost_source).toBe("gateway");
    expect(after.gateway_generation_id).toBe("gen_a");
  });

  it("case 6: UPDATE of gateway-owned cost_usd with new gateway_generation_id is allowed (W7 refresh)", async () => {
    const inserted = await insertCall(db, {
      model: MODELS.sonnet.id,
      cost_usd: 0.5,
      cost_source: "gateway",
      gateway_generation_id: "gen_a",
    });
    await db.query(
      "UPDATE ai_calls SET cost_usd = $2, gateway_generation_id = $3 WHERE id = $1",
      [inserted.id, 0.75, "gen_b"]
    );
    const after = await selectCall(db, inserted.id as string);
    assertNumEq(after.cost_usd, 0.75);
    expect(after.cost_source).toBe("gateway");
    expect(after.gateway_generation_id).toBe("gen_b");
  });

  it("case 7: UPDATE of cost_usd on trigger-owned row with no pricing input change raises", async () => {
    const inserted = await insertCall(db, {
      model: MODELS.sonnet.id,
      input_tokens: 1_000,
      output_tokens: 500,
    });
    expect(inserted.cost_source).toBe("trigger");

    await expectUpdateRejected(
      db,
      inserted.id as string,
      { cost_usd: 0.99 },
      /cost_usd is computed while cost_source=trigger/
    );

    await db.query(
      "UPDATE ai_calls SET cost_usd = $2, cost_source = 'manual' WHERE id = $1",
      [inserted.id, 0.99]
    );
    const after = await selectCall(db, inserted.id as string);
    assertNumEq(after.cost_usd, 0.99);
    expect(after.cost_source).toBe("manual");
  });

  it("case 8: UPDATE of gateway-owned cost_usd without moving gateway_generation_id raises", async () => {
    const inserted = await insertCall(db, {
      model: MODELS.sonnet.id,
      cost_usd: 0.5,
      cost_source: "gateway",
      gateway_generation_id: "gen_a",
    });

    await expectUpdateRejected(
      db,
      inserted.id as string,
      { cost_usd: 0.75 },
      /owned by gateway reconciliation/
    );
  });

  it("case 9: gateway to manual demotion preserves the caller-supplied cost_usd", async () => {
    const inserted = await insertCall(db, {
      model: MODELS.sonnet.id,
      cost_usd: 0.5,
      cost_source: "gateway",
      gateway_generation_id: "gen_a",
    });
    await db.query(
      "UPDATE ai_calls SET cost_usd = $2, cost_source = 'manual' WHERE id = $1",
      [inserted.id, 0.77]
    );
    const after = await selectCall(db, inserted.id as string);
    assertNumEq(after.cost_usd, 0.77);
    expect(after.cost_source).toBe("manual");
  });

  it("case 10: gateway to trigger demotion releases ownership and recomputes from tokens", async () => {
    const m = MODELS.sonnet;
    const inserted = await insertCall(db, {
      model: m.id,
      input_tokens: 1_000,
      output_tokens: 500,
      cost_usd: 0.99,
      cost_source: "gateway",
      gateway_generation_id: "gen_a",
    });
    assertNumEq(inserted.cost_usd, 0.99);

    await db.query(
      "UPDATE ai_calls SET cost_source = 'trigger' WHERE id = $1",
      [inserted.id]
    );
    const after = await selectCall(db, inserted.id as string);
    const expected = 1_000 * m.pricing_input + 500 * m.pricing_output;
    assertNumEq(after.cost_usd, expected);
    expect(after.cost_source).toBe("trigger");
  });

  it("bonus: UPDATE that sets cost_source=gateway without gateway_generation_id is allowed only as initial claim", async () => {
    const a = await insertCall(db, {
      model: MODELS.sonnet.id,
      input_tokens: 100,
      output_tokens: 100,
    });
    await db.query(
      "UPDATE ai_calls SET cost_usd = $2, cost_source = 'gateway' WHERE id = $1",
      [a.id, 0.4]
    );
    const after = await selectCall(db, a.id as string);
    expect(after.cost_source).toBe("gateway");
    assertNumEq(after.cost_usd, 0.4);
  });
});
