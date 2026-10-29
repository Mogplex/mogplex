import { afterEach, expect, it, vi } from "vitest";
import {
  acquireFlowActivationLock,
  releaseFlowActivationLock,
} from "@/lib/flows/activation-lock";
import { createFlowTriggerDispatcher } from "@/lib/flows/trigger-dispatch";
import { WORKFLOW_ONCE_RETRY, runWorkflowOnce } from "@/trigger/workflow-once";
import { createAutomationDb } from "./helpers/mcp-automation-fixture";

afterEach(() => vi.useRealTimers());

it("a due run survives an activation that outlasts the old retry window and queues once", async () => {
  const db = await createAutomationDb();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2027-01-15T00:00:00Z"));
  try {
    const runAt = new Date().toISOString();
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
        "insert into flows(user_id,installation_id,status,trigger_once_run_id,draft_graph) values('owner',123,'inactive','run_current',$1) returning id",
        [JSON.stringify(graph)]
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
    const held = await acquireFlowActivationLock(flow.id);
    if (!held.acquired) throw new Error("Fixture lock not acquired");
    const releaseAt = Date.now() + 12_000;
    let queued = 0;
    const dispatch = createFlowTriggerDispatcher({
      enqueue: async () => {
        queued++;
        return { jobRunId: "job", outcome: "queued", reason: null };
      },
      start: async () => ({ started: true, status: "running" }),
    });
    const payload = { flowId: flow.id, versionId: version.id, runAt };
    let delivered = false;
    // Exercise the external scheduler contract with a virtual clock, while
    // lock ownership and dispatch read the real database on every attempt.
    for (
      let attempt = 0;
      attempt < WORKFLOW_ONCE_RETRY.maxAttempts;
      attempt++
    ) {
      if (Date.now() >= releaseAt)
        await releaseFlowActivationLock(flow.id, held.token);
      try {
        delivered = (await runWorkflowOnce(payload, "run_current", dispatch))
          .started;
        break;
      } catch (error) {
        expect(error).toMatchObject({ code: "FLOW_ACTIVATION_IN_PROGRESS" });
        expect(queued).toBe(0);
        const delay = Math.min(
          WORKFLOW_ONCE_RETRY.minTimeoutInMs *
            WORKFLOW_ONCE_RETRY.factor ** attempt,
          WORKFLOW_ONCE_RETRY.maxTimeoutInMs
        );
        vi.setSystemTime(Date.now() + delay);
      }
    }
    expect(delivered).toBe(true);
    expect(queued).toBe(1);
    expect(
      (await runWorkflowOnce(payload, "run_current", dispatch)).reason
    ).toBe("FLOW_INACTIVE");
    expect(queued).toBe(1);
  } finally {
    await db.close();
  }
});
