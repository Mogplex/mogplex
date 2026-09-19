import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { vector } from "@electric-sql/pglite/vector";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyNeonMigrations } from "@/lib/db/neon-migrations";

const EXISTING_NODE_TYPES = [
  "start",
  "agent",
  "action",
  "condition",
  "parallel",
  "join",
  "delay",
  "await_event",
  "set_variable",
  "transform",
  "end",
];

describe("flow_node_runs node types", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await PGlite.create({
      extensions: { vector, pg_trgm, pgcrypto, uuid_ossp },
    });
    expect(
      (await applyNeonMigrations(db, { log: () => {}, warn: () => {} })).ok
    ).toBe(true);
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  // Foreign keys are enforced by triggers; turning them off lets the test
  // exercise the node_type check with a real insert and no fixture graph.
  async function insertNodeRun(nodeType: string) {
    await db.query("set session_replication_role = replica");
    try {
      await db.query(
        `insert into flow_node_runs (user_id, job_run_id, flow_id, node_id, node_type, status)
         values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), $1, $2, 'success')`,
        [`${nodeType}-1`, nodeType]
      );
    } finally {
      await db.query("set session_replication_role = origin");
    }
  }

  it("should store a classify node run", async () => {
    await insertNodeRun("classify");
    const { rows } = await db.query<{ count: number }>(
      "select count(*)::int as count from flow_node_runs where node_type = 'classify'"
    );
    expect(rows[0]?.count).toBe(1);
  });

  it("should keep storing every node type older workers write", async () => {
    for (const nodeType of EXISTING_NODE_TYPES) {
      await expect(insertNodeRun(nodeType), nodeType).resolves.toBeUndefined();
    }
  });

  it("should still reject a node type that does not exist", async () => {
    await expect(insertNodeRun("teleport")).rejects.toThrow(
      /flow_node_runs_node_type_check/
    );
  });
});
