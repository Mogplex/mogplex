import { beforeEach, describe, expect, test } from "vitest";
import {
  createSupersessionDb,
  type Db,
  DEPRECATED,
  readState,
  runUpgrade,
  seedCatalog,
  seedUser,
  SUCCESSOR,
} from "./helpers/model-supersessions-fixtures";

describe("upgrade_deprecated_model_pins - edge cases", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createSupersessionDb();
  });

  test("withholds the upgrade when a team allowlist permits the pin but not the successor", async () => {
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

  test("model_supersessions_effective hides a successor that is not offered", async () => {
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

  test("retracts the supersession when the deprecated model returns to the catalog", async () => {
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

  test("does not bump flows.updated_at - the cron must not look like a user edit", async () => {
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

    expect((await readState(db, userId)).nodes[0]!.data.modelOverride).toBe(
      SUCCESSOR
    );
    expect(after.rows[0]!.updated_at).toEqual(before.rows[0]!.updated_at);
  });

  test("is not executable by anon or authenticated, only service_role", async () => {
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
});
