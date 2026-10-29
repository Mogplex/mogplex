import { afterEach, expect, it, vi } from "vitest";
import {
  recordWorkflowOnceFailure,
  runWorkflowOnce,
} from "@/trigger/workflow-once";
import { deleteFlow } from "@/lib/flows/server-flow-ops";
import { createAutomationDb } from "./helpers/mcp-automation-fixture";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("exhausted dispatch failures disarm only the matching version and runtime", async () => {
  const db = await createAutomationDb();
  try {
    const flow = (
      await db.pg.query<{ id: string }>(
        "insert into flows(user_id,installation_id,status,trigger_once_run_id) values('owner',123,'inactive','run_current') returning id"
      )
    ).rows[0];
    const version = (
      await db.pg.query<{ id: string }>(
        "insert into flow_versions(flow_id,version_number,graph) values($1,1,'{}') returning id",
        [flow.id]
      )
    ).rows[0];
    await db.pg.query(
      "update flows set status='active',published_version_id=$2 where id=$1",
      [flow.id, version.id]
    );
    const payload = {
      flowId: flow.id,
      versionId: version.id,
      runAt: "2027-01-15T15:00:00Z",
    };
    await expect(
      runWorkflowOnce(payload, async () => {
        throw new Error("fixture enqueue failed");
      })
    ).rejects.toThrow("fixture enqueue failed");
    await recordWorkflowOnceFailure(
      { ...payload, versionId: "33333333-3333-4333-8333-333333333333" },
      "run_current"
    );
    await recordWorkflowOnceFailure(payload, "run_obsolete");
    expect(
      (
        await db.pg.query<{ status: string }>(
          "select status from flows where id=$1",
          [flow.id]
        )
      ).rows[0].status
    ).toBe("active");
    await recordWorkflowOnceFailure(payload, "run_current");
    expect(
      (
        await db.pg.query(
          "select status,trigger_once_run_id from flows where id=$1",
          [flow.id]
        )
      ).rows[0]
    ).toEqual({ status: "inactive", trigger_once_run_id: null });
  } finally {
    await db.close();
  }
});

it.each([404, 403])(
  "deleting a one-time handle handles provider HTTP %s explicitly",
  async (status) => {
    const db = await createAutomationDb();
    vi.stubEnv("TRIGGER_SECRET_KEY", "tr_dev_fixture");
    vi.stubGlobal("fetch", async () =>
      Response.json({ error: "fixture cancel response" }, { status })
    );
    try {
      const flow = (
        await db.pg.query<{ id: string }>(
          "insert into flows(user_id,installation_id,status,trigger_once_run_id) values('owner',123,'inactive','run_stale') returning id"
        )
      ).rows[0];
      if (status === 404) {
        await expect(deleteFlow("owner", flow.id)).resolves.toEqual({
          ok: true,
        });
        expect(
          (await db.pg.query("select id from flows where id=$1", [flow.id]))
            .rows
        ).toEqual([]);
      } else {
        await expect(deleteFlow("owner", flow.id)).rejects.toMatchObject({
          code: "FLOW_DELETE_SYNC_FAILED",
        });
        expect(
          (await db.pg.query("select id from flows where id=$1", [flow.id]))
            .rows
        ).toHaveLength(1);
      }
    } finally {
      await db.close();
    }
  }
);
