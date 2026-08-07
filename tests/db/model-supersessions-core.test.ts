import { beforeEach, describe, expect, test } from "vitest";
import {
  agentNode,
  createSupersessionDb,
  type Db,
  DEPRECATED,
  readState,
  runUpgrade,
  seedCatalog,
  seedUser,
  SUCCESSOR,
} from "./helpers/model-supersessions-fixtures";

describe("upgrade_deprecated_model_pins - core", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createSupersessionDb();
  });

  test("upgrades automation pins, agent base models, and default models", async () => {
    await seedCatalog(db);
    const userId = await seedUser(db);

    const counts = await runUpgrade(db);
    expect(counts).toEqual({ flows: 1, agents: 1, profiles: 1 });

    const state = await readState(db, userId);
    expect(state.agentModel).toBe(SUCCESSOR);
    expect(state.defaultModel).toBe(SUCCESSOR);

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

  test("is idempotent - a second run upgrades nothing", async () => {
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
    await seedCatalog(db, { successorAvailable: false });
    const userId = await seedUser(db);

    expect(await runUpgrade(db)).toEqual({
      flows: 0,
      agents: 0,
      profiles: 0,
    });
    expect((await readState(db, userId)).agentModel).toBe(DEPRECATED);
  });

  test("upgrades one user while respecting anothers opt-out", async () => {
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

  test("rewrite is computed from the row, not a stale snapshot", async () => {
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
    expect(state.nodes.map((node) => node.id)).toEqual([
      "agent-1",
      "agent-2",
      "agent-3",
      "action-1",
      "agent-late",
    ]);
    expect(state.nodes[0]!.data.modelOverride).toBe(SUCCESSOR);
  });

  test("can be called twice in one transaction", async () => {
    await seedCatalog(db);
    await seedUser(db);

    await db.exec("BEGIN");
    await runUpgrade(db);
    await runUpgrade(db);
    await db.exec("COMMIT");
  });

  test("returns early without touching flows when nothing needs upgrading", async () => {
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

    expect(await runUpgrade(db)).toEqual({
      flows: 0,
      agents: 0,
      profiles: 0,
    });
  });

  test("early exit does not fire when a pin does need upgrading", async () => {
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
