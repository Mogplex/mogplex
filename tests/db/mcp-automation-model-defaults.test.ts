import { expect, it } from "vitest";
import { coerceGraph } from "@/lib/flows/graph";
import { scheduledTaskExample } from "@/lib/mogplex-api/automation-schema";
import { resolveJobContext } from "@/lib/workflows/automation-job-context-resolution";
import { createAutomationJobTask } from "@/lib/workflows/automation-job-workflow";
import {
  createAutomationDb,
  AGENT_ID,
  REPO_ID,
} from "./helpers/mcp-automation-fixture";

it("an unpinned published flow uses current scoped defaults while explicit overrides persist", async () => {
  const db = await createAutomationDb();
  try {
    await db.pg.exec(`
      insert into ai_models(id,provider,name,is_available) values ('openai/surface','openai','Surface',true), ('openai/global','openai','Global',true);
      update profiles set default_model='openai/global', surface_models='{"agents":"openai/surface"}' where id='owner';
    `);
    const graph = coerceGraph(structuredClone(scheduledTaskExample));
    const task = graph.nodes.find((node) => node.type === "agent")!;
    task.data.agentId = AGENT_ID;
    task.data.modelOverride = null;
    const flow = (
      await db.pg.query<{ id: string }>(
        "insert into flows(user_id,installation_id,draft_graph) values('owner',123,$1) returning id",
        [JSON.stringify(graph)]
      )
    ).rows[0];
    const version = (
      await db.pg.query<{ id: string }>(
        "insert into flow_versions(flow_id,version_number,graph) values($1,1,$2) returning id",
        [flow.id, JSON.stringify(graph)]
      )
    ).rows[0];
    const job = (
      await db.pg.query<{ id: string }>(
        "insert into job_runs(flow_id,flow_version_id,metadata) values($1,$2,$3) returning id",
        [
          flow.id,
          version.id,
          JSON.stringify({ source_type: "schedule", repo_id: REPO_ID }),
        ]
      )
    ).rows[0];
    const models: string[] = [];
    const run = createAutomationJobTask({
      resolveGithubToken: async () => "fixture-token",
      resolveAutomationModel: async (_userId, modelId) => ({
        model: {} as never,
        effectiveModelId: modelId,
      }),
      runAutomationAgent: async (context) => {
        models.push(context.agent.model);
        return { text: "NO_ACTION", steps: [], usage: null };
      },
      getDurationMs: async () => 10,
      persistJobSuccess: async () => true,
      persistJobFailure: async () => true,
      tryLogAiCall: async () => null,
      recordControlDispatchEvent: async () => {},
      releaseQueuedJobs: async () => [],
      isJobRunCancellationRequested: async () => false,
      throwIfJobRunCancelled: async () => {},
    });
    const execute = async () =>
      run({
        jobRunId: job.id,
        startedAt: new Date().toISOString(),
        releasedScope: {
          sourceKind: "flow",
          sourceType: "schedule",
          sourceId: flow.id,
          repoId: REPO_ID,
          installationId: 123,
        },
      });
    expect((await execute()).success).toBe(true);
    expect(models).toEqual(["openai/surface"]);
    await db.pg.exec(
      "update profiles set surface_models='{}' where id='owner'"
    );
    expect((await execute()).success).toBe(true);
    expect(models).toEqual(["openai/surface", "openai/global"]);
    task.data.modelOverride = "openai/test-model";
    await db.pg.query("update flow_versions set graph=$1 where id=$2", [
      JSON.stringify(graph),
      version.id,
    ]);
    expect((await execute()).success).toBe(true);
    expect(models.at(-1)).toBe("openai/test-model");
    task.data.modelOverride = null;
    await db.pg.query("update flow_versions set graph=$1 where id=$2", [
      JSON.stringify(graph),
      version.id,
    ]);
    await db.pg.exec("update ai_models set is_available=false");
    expect((await execute()).success).toBe(false);
    expect(models).toHaveLength(3);
    const context = await resolveJobContext(job.id);
    expect("flow" in context && context.flow?.defaultModelId).toBeNull();
    const stored = (
      await db.pg.query<{ graph: typeof graph }>(
        "select graph from flow_versions where id=$1",
        [version.id]
      )
    ).rows[0].graph;
    expect(
      stored.nodes.find((node) => node.type === "agent")!.data.modelOverride
    ).toBeNull();
  } finally {
    await db.close();
  }
});
