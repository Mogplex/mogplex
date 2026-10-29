import { expect, it } from "vitest";
import { saveFlowVersion } from "@/lib/flows/server-version";
import { loadOwnedFlow } from "@/lib/flows/server-flow-ops";
import { coerceGraph } from "@/lib/flows/graph";
import { createAutomationDb } from "./helpers/mcp-automation-fixture";
import { createTestMogplexApiAutomation } from "@/lib/mogplex-api/automation-test";
import { scheduledTaskExample } from "@/lib/mogplex-api/automation-schema";

it("reuses equivalent populated draft graphs regardless of data key order, while publishing creates a new version", async () => {
  const db = await createAutomationDb();
  try {
    const id = (
      await db.pg.query<{ id: string }>(
        "insert into flows(user_id,installation_id,status,draft_graph) values('owner',123,'inactive','{}') returning id"
      )
    ).rows[0].id;
    const graph = coerceGraph(structuredClone(scheduledTaskExample));
    const first = await saveFlowVersion(id, graph, { isTest: true });
    const reordered = structuredClone(graph);
    for (const node of reordered.nodes) {
      node.data = Object.fromEntries(
        Object.entries(node.data).toReversed()
      ) as typeof node.data;
    }
    const repeated = await saveFlowVersion(id, reordered, { isTest: true });
    expect(repeated.id).toBe(first.id);
    const published = await saveFlowVersion(id, reordered);
    expect(published.id).not.toBe(first.id);
    expect(published.is_test).toBe(false);
  } finally {
    await db.close();
  }
});

it("a restricted direct caller is refused before database access", async () => {
  const db = await createAutomationDb();
  try {
    await expect(
      createTestMogplexApiAutomation()({
        userId: "owner",
        automationId: "missing",
        repoId: "missing",
        idempotencyKey: "restricted",
        credential: {
          kind: "integration",
          keyId: "restricted",
          automationOnly: true,
        },
      })
    ).rejects.toMatchObject({ code: "AUTOMATION_NOT_INTEGRATION_ENABLED" });
    expect(db.statements).toEqual([]);
  } finally {
    await db.close();
  }
});

it("draft snapshots remain distinct from publication and never become repair candidates", async () => {
  const db = await createAutomationDb();
  try {
    const id = (
      await db.pg.query<{ id: string }>(
        "insert into flows(user_id,installation_id,status,draft_graph) values('owner',123,'inactive','{}') returning id"
      )
    ).rows[0].id;
    const graph = coerceGraph({ nodes: [], edges: [] });
    const published = await saveFlowVersion(id, graph);
    const draft = await saveFlowVersion(id, graph, { isTest: true });
    expect(draft.id).not.toBe(published.id);
    expect((await saveFlowVersion(id, graph, { isTest: true })).id).toBe(
      draft.id
    );
    expect(
      (
        await db.pg.query("select is_test from flow_versions where id=$1", [
          draft.id,
        ])
      ).rows[0]
    ).toEqual({ is_test: true });
    // An older publisher/repair path cannot bypass the marker by writing the
    // pointer directly; existing versions and legacy writes remain valid.
    await db.pg.exec(
      "create role retained_app; grant select,update on flows to retained_app; set role retained_app"
    );
    try {
      await expect(
        db.pg.query("update flows set published_version_id=$2 where id=$1", [
          id,
          draft.id,
        ])
      ).rejects.toMatchObject({
        code: "23514",
        constraint: "flows_published_version_not_test",
      });
    } finally {
      await db.pg.exec("reset role");
    }
    await db.pg.query("update flows set status='active' where id=$1", [id]);
    expect((await loadOwnedFlow("owner", id))?.published_version_id).toBe(
      published.id
    );
    // If there is no published snapshot to recover, keep the draft private.
    await db.pg.query(
      "update flows set published_version_id=null where id=$1",
      [id]
    );
    await db.pg.query("delete from flow_versions where id=$1", [published.id]);
    const repaired = await loadOwnedFlow("owner", id);
    expect(repaired?.published_version_id).toBeNull();
    expect(repaired?.status).toBe("inactive");
  } finally {
    await db.close();
  }
});
