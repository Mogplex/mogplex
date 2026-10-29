import { expect, it, vi } from "vitest";
import {
  createMogplexApiAutomation,
  publishMogplexApiAutomation,
} from "@/lib/mogplex-api/automations";
import { automationSchemaGuide } from "@/lib/mogplex-api/automation-schema";
import { coerceGraph } from "@/lib/flows/graph";
import { syncFlowActivation } from "@/lib/flows/server-publish";
import { createFlowTriggerDispatcher } from "@/lib/flows/trigger-dispatch";
import { runWorkflowOnce } from "@/trigger/workflow-once";
import { createAutomationDb } from "./helpers/mcp-automation-fixture";

it("arms one durable future dispatch, replaces and pauses it, and ignores stale or repeated deliveries", async () => {
  const db = await createAutomationDb();
  const previousKey = process.env.TRIGGER_SECRET_KEY;
  process.env.TRIGGER_SECRET_KEY = "tr_dev_fixture";
  const requests: { path: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (!url.hostname.endsWith("trigger.dev"))
        throw new Error(`Unexpected network: ${url}`);
      const body = JSON.parse(String(init?.body ?? "{}"));
      requests.push({ path: url.pathname, body });
      return Response.json({
        id: `run_${requests.length}`,
        publicAccessToken: "fixture",
      });
    }
  );
  try {
    const graph = coerceGraph(
      structuredClone(automationSchemaGuide.examples.oneTimeTask)
    );
    const start = graph.nodes.find((node) => node.type === "start")!;
    start.data.scheduleRunAt = new Date(Date.now() + 86_400_000).toISOString();
    start.data.filter = {
      scope: "org",
      installationIds: [123],
      repos: ["acme/widgets"],
    };
    const agent = graph.nodes.find((node) => node.type === "agent")!;
    agent.data.harness = "codex";
    agent.data.agentId = null;
    const flow = await createMogplexApiAutomation("owner", {
      installationId: 123,
      graph,
    });
    expect(requests).toEqual([]);
    const first = await publishMogplexApiAutomation("owner", flow.id);
    expect(requests[0].path).toContain("dispatch-workflow-once/trigger");
    expect(JSON.stringify(requests[0].body)).toContain(
      start.data.scheduleRunAt!
    );
    expect(requests.some((r) => r.path.includes("schedules"))).toBe(false);
    const second = await publishMogplexApiAutomation("owner", flow.id);
    expect(requests.some((r) => r.path.includes("/cancel"))).toBe(true);
    await syncFlowActivation("owner", flow.id, "inactive");
    await syncFlowActivation("owner", flow.id, "active");
    let jobs = 0;
    const dispatch = createFlowTriggerDispatcher({
      enqueue: async () => {
        jobs++;
        return { jobRunId: "job", outcome: "queued", reason: null };
      },
      start: async () => ({ started: true, status: "running" }),
    });
    const payload = {
      flowId: flow.id,
      versionId: second.publishedVersion!.id,
      runAt: start.data.scheduleRunAt!,
    };
    expect(
      (
        await runWorkflowOnce(
          { ...payload, versionId: first.publishedVersion!.id },
          dispatch
        )
      ).reason
    ).toBe("SCHEDULE_REPLACED");
    expect(jobs).toBe(0);
    expect((await runWorkflowOnce(payload, dispatch)).started).toBe(true);
    expect((await runWorkflowOnce(payload, dispatch)).reason).toBe(
      "FLOW_INACTIVE"
    );
    expect(jobs).toBe(1);
    const stored = (
      await db.pg.query<{ status: string; trigger_once_run_id: string | null }>(
        "select status,trigger_once_run_id from flows where id=$1",
        [flow.id]
      )
    ).rows[0];
    expect(stored).toEqual({ status: "inactive", trigger_once_run_id: null });
  } finally {
    vi.unstubAllGlobals();
    if (previousKey === undefined) delete process.env.TRIGGER_SECRET_KEY;
    else process.env.TRIGGER_SECRET_KEY = previousKey;
    await db.close();
  }
});
