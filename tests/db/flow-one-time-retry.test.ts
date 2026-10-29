import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { createFlowTriggerDispatcher } from "@/lib/flows/trigger-dispatch";
import { runWorkflowOnce } from "@/trigger/workflow-once";
import { createAutomationDb } from "./helpers/mcp-automation-fixture";

it.each([false, true])(
  "retrying a partial one-time dispatch keeps one run (already claimed: %s)",
  async (alreadyClaimed) => {
    const db = await createAutomationDb();
    try {
      const userId = "44444444-4444-4444-8444-444444444444";
      await db.pg.exec(`
        alter table job_runs add column retry_of_job_run_id uuid,
          add column idempotency_key text unique;
        create table triggers(id uuid, installation_id bigint);
        create table automation_dispatch_events(user_id uuid, job_run_id uuid,
          assignment_id uuid, trigger_id uuid, flow_id uuid, flow_version_id uuid,
          repo_id uuid, installation_id bigint, source_kind text, source_type text,
          event_kind text, outcome text, reason text, metadata jsonb);
        update repos set user_id='${userId}';
      `);
      await db.pg.exec(
        await readFile(
          new URL(
            "../../supabase/migrations/20260329120000_automation_dispatch_flow_source_kind.sql",
            import.meta.url
          ),
          "utf8"
        )
      );
      const runAt = "2027-01-15T00:00:00Z";
      const graph = {
        nodes: [
          {
            id: "start",
            type: "start",
            position: { x: 0, y: 0 },
            data: {
              event: "schedule",
              scheduleRunAt: runAt,
              filter: { repos: ["acme/widgets"] },
            },
          },
        ],
        edges: [],
      };
      const flow = (
        await db.pg.query<{ id: string }>(
          "insert into flows(user_id,installation_id,status,trigger_once_run_id,draft_graph) values($1,123,'inactive','run_current',$2) returning id",
          [userId, JSON.stringify(graph)]
        )
      ).rows[0];
      const version = (
        await db.pg.query<{ id: string }>(
          "insert into flow_versions(flow_id,version_number,graph) values($1,1,$2) returning id",
          [flow.id, JSON.stringify(graph)]
        )
      ).rows[0];
      await db.pg.query(
        "update flows set status='active',published_version_id=$2 where id=$1",
        [flow.id, version.id]
      );
      let startAttempts = 0;
      let claims = 0;
      const dispatch = createFlowTriggerDispatcher({
        start: async (jobRunId, source) => {
          expect(source).toBe("cron");
          startAttempts++;
          if (startAttempts === 1 && !alreadyClaimed)
            throw new Error("fixture start interrupted");
          // The runtime starter claims pending jobs atomically. A retry must
          // reach it, while an already claimed job must never execute twice.
          const claimed = await db.pg.query(
            "update job_runs set status='running' where id=$1 and status='pending' returning id",
            [jobRunId]
          );
          claims += claimed.rows.length;
          if (startAttempts === 1) throw new Error("fixture start interrupted");
          return { started: claimed.rows.length === 1, status: "running" };
        },
      });
      const payload = { flowId: flow.id, versionId: version.id, runAt };
      await expect(
        runWorkflowOnce(payload, "run_current", dispatch)
      ).rejects.toThrow("fixture start interrupted");
      expect(
        (
          await db.pg.query(
            "select status,trigger_once_run_id from flows where id=$1",
            [flow.id]
          )
        ).rows[0]
      ).toEqual({ status: "active", trigger_once_run_id: "run_current" });
      await runWorkflowOnce(payload, "run_current", dispatch);
      expect((await db.pg.query("select status from job_runs")).rows).toEqual([
        { status: "running" },
      ]);
      expect(startAttempts).toBe(2);
      expect(claims).toBe(1);
      expect(
        (
          await db.pg.query(
            "select outcome,reason from automation_dispatch_events order by ctid"
          )
        ).rows
      ).toEqual([
        { outcome: "queued", reason: null },
        { outcome: "suppressed", reason: "IDEMPOTENT_DUPLICATE" },
      ]);
      expect(
        (
          await db.pg.query(
            "select status,trigger_once_run_id from flows where id=$1",
            [flow.id]
          )
        ).rows[0]
      ).toEqual({ status: "inactive", trigger_once_run_id: null });
      expect(
        (await runWorkflowOnce(payload, "run_current", dispatch)).reason
      ).toBe("FLOW_INACTIVE");
      expect(startAttempts).toBe(2);
    } finally {
      await db.close();
    }
  }
);
