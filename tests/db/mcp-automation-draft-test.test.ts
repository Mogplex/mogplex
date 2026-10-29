import { expect, it } from "vitest";
import { createTestMogplexApiAutomation } from "@/lib/mogplex-api/automation-test";
import type { AutomationTriggerDeps } from "@/lib/mogplex-api/automation-trigger";
import { createMogplexApiAutomation } from "@/lib/mogplex-api/automations";
import { scheduledTaskExample } from "@/lib/mogplex-api/automation-schema";
import { coerceGraph } from "@/lib/flows/graph";
import { TRIGGER_EVENTS } from "@/lib/flows/assistant-tools-constants";
import { resolveJobContext } from "@/lib/workflows/automation-job-context-resolution";
import { createAutomationJobTask } from "@/lib/workflows/automation-job-workflow";
import {
  createAutomationDb,
  AGENT_ID,
  REPO_ID,
} from "./helpers/mcp-automation-fixture";

it("executes saved draft snapshots for every trigger without publishing or activating them", async () => {
  const db = await createAutomationDb();
  try {
    await db.pg.exec(
      "alter table job_runs add column idempotency_key text unique"
    );
    let starts = 0;
    const enqueue: AutomationTriggerDeps["enqueue"] = async (input) => {
      const existing = (
        await db.pg.query<{ id: string }>(
          "select id from job_runs where idempotency_key=$1",
          [input.idempotencyKey]
        )
      ).rows[0];
      if (existing)
        return {
          jobRunId: existing.id,
          outcome: "suppressed",
          reason: "IDEMPOTENT_DUPLICATE",
        };
      const job = (
        await db.pg.query<{ id: string }>(
          "insert into job_runs(flow_id,flow_version_id,metadata,idempotency_key) values($1,$2,$3,$4) returning id",
          [
            input.flowId,
            input.flowVersionId,
            JSON.stringify(input.metadata),
            input.idempotencyKey,
          ]
        )
      ).rows[0];
      return { jobRunId: job.id, outcome: "queued", reason: null };
    };
    const runTest = createTestMogplexApiAutomation({
      enqueue,
      start: async () => {
        starts++;
        return { started: true, status: "running" };
      },
    });
    for (const event of TRIGGER_EVENTS) {
      const graph = coerceGraph(structuredClone(scheduledTaskExample));
      const start = graph.nodes.find((node) => node.type === "start")!;
      start.data.event = event;
      start.data.filter = {
        scope: "org",
        installationIds: [123],
        repos: ["acme/widgets"],
      };
      start.data.slackTeamId = "team";
      start.data.slackChannelId = "channel";
      if (event === "api")
        start.data.inputFields = [
          { key: "title", type: "string", required: true },
        ];
      const task = graph.nodes.find((node) => node.type === "agent")!;
      task.data.agentId = AGENT_ID;
      task.data.role = ["schedule", "api"].includes(event) ? "task" : "triage";
      const flow = await createMogplexApiAutomation("owner", {
        installationId: 123,
        name: event,
        graph,
      });
      const args = {
        userId: "owner",
        automationId: flow.id,
        repoId: REPO_ID,
        idempotencyKey: "first",
        input: { title: "Test path", pr_number: 12 },
      };
      if (event === "api")
        args.input = { title: "Test path" } as typeof args.input;
      const run = await runTest(args);
      expect(run.started).toBe(true);
      const versions = (
        await db.pg.query("select id from flow_versions where flow_id=$1", [
          flow.id,
        ])
      ).rows;
      const replay = await runTest(args);
      expect(
        (
          await db.pg.query("select id from flow_versions where flow_id=$1", [
            flow.id,
          ])
        ).rows
      ).toEqual(versions);
      expect(replay.jobRunId).toBe(run.jobRunId);
      expect(replay.versionId).toBe(run.versionId);
      expect(replay.replayed).toBe(true);
      const context = await resolveJobContext(run.jobRunId!);
      expect("flow" in context && context.flow?.flowVersionId).toBe(
        run.versionId
      );
      expect(
        "context" in context && context.context.metadata.automation_test
      ).toBe(true);
      expect(
        "context" in context && context.context.metadata.flow_version_is_test
      ).toBe(true);
      const saved = (
        await db.pg.query<{
          status: string;
          published_version_id: string | null;
          trigger_once_run_id: string | null;
          trigger_schedule_id: string | null;
        }>(
          "select status,published_version_id,trigger_once_run_id,trigger_schedule_id from flows where id=$1",
          [flow.id]
        )
      ).rows[0];
      expect(saved).toEqual({
        status: "inactive",
        published_version_id: null,
        trigger_once_run_id: null,
        trigger_schedule_id: null,
      });
      await expect(
        runTest({ ...args, input: { title: "Different input" } })
      ).rejects.toThrow(/different input/);
      await db.pg.query(
        "update flows set draft_graph=jsonb_set(draft_graph,'{nodes,1,data,systemPromptOverride}', '\"Changed instructions\"') where id=$1",
        [flow.id]
      );
      await expect(runTest(args)).rejects.toThrow(/different input/);
    }
    expect(starts).toBe(TRIGGER_EVENTS.length);
  } finally {
    await db.close();
  }
}, 60_000);

it("refuses foreign drafts, invalid configurations and restricted credentials before starting work", async () => {
  const db = await createAutomationDb();
  try {
    const flow = await createMogplexApiAutomation("owner", {
      installationId: 123,
    });
    const args = {
      userId: "owner",
      automationId: flow.id,
      repoId: REPO_ID,
      idempotencyKey: "test",
    };
    const runTest = createTestMogplexApiAutomation({
      start: async () => {
        throw new Error("must not start");
      },
    });
    await expect(runTest({ ...args, userId: "other" })).rejects.toThrow(
      /not found/
    );
    await expect(
      runTest({
        ...args,
        credential: { kind: "integration", keyId: "key", automationOnly: true },
      })
    ).rejects.toThrow(/Full access/);
    await db.pg.query("update flows set draft_graph='{}' where id=$1", [
      flow.id,
    ]);
    await expect(runTest(args)).rejects.toThrow();
    expect((await db.pg.query("select * from job_runs")).rows).toEqual([]);
  } finally {
    await db.close();
  }
});

it("records draft execution errors before activation while preserving the published schedule", async () => {
  const db = await createAutomationDb();
  try {
    const graph = coerceGraph(structuredClone(scheduledTaskExample));
    graph.nodes.find((node) => node.type === "start")!.data.filter = {
      scope: "org",
      installationIds: [123],
      repos: ["acme/widgets"],
    };
    graph.nodes.find((node) => node.type === "agent")!.data.agentId = AGENT_ID;
    const flow = await createMogplexApiAutomation("owner", {
      installationId: 123,
      graph,
    });
    const liveVersion = (
      await db.pg.query<{ id: string }>(
        "insert into flow_versions(flow_id,version_number,graph) values($1,1,$2) returning id",
        [flow.id, JSON.stringify(graph)]
      )
    ).rows[0].id;
    await db.pg.query(
      "update flows set status='active',published_version_id=$2,trigger_once_run_id='run_live' where id=$1",
      [flow.id, liveVersion]
    );
    const engine = createAutomationJobTask({
      resolveGithubToken: async () => "fixture-token",
      resolveAutomationModel: async (_userId, modelId) => ({
        model: {} as never,
        effectiveModelId: modelId,
      }),
      runAutomationAgent: async () => {
        throw new Error("Fixture dependency is unavailable");
      },
      getDurationMs: async () => 1,
      persistJobFailure: async ({ jobRunId }) => {
        await db.pg.query("update job_runs set status='failed' where id=$1", [
          jobRunId,
        ]);
        return true;
      },
      tryLogAiCall: async () => null,
      recordControlDispatchEvent: async () => {},
      releaseQueuedJobs: async () => [],
      isJobRunCancellationRequested: async () => false,
      throwIfJobRunCancelled: async () => {},
    });
    const runTest = createTestMogplexApiAutomation({
      enqueue: async (input) => {
        const job = (
          await db.pg.query<{ id: string }>(
            "insert into job_runs(flow_id,flow_version_id,metadata) values($1,$2,$3) returning id",
            [input.flowId, input.flowVersionId, JSON.stringify(input.metadata)]
          )
        ).rows[0];
        return { jobRunId: job.id, outcome: "queued", reason: null };
      },
      start: async (jobRunId) => {
        const result = await engine({
          jobRunId,
          startedAt: new Date().toISOString(),
          releasedScope: {
            sourceKind: "flow",
            sourceType: "schedule",
            sourceId: flow.id,
            repoId: REPO_ID,
            installationId: 123,
          },
        });
        expect(result.success).toBe(false);
        return { started: true, status: "failed" };
      },
    });
    const tested = await runTest({
      userId: "owner",
      automationId: flow.id,
      repoId: REPO_ID,
      idempotencyKey: "failing-draft",
    });
    expect(tested.status).toBe("failed");
    const nodes = (
      await db.pg.query<{ status: string; error: string }>(
        "select status,error from flow_node_runs where node_type='agent' and job_run_id=$1",
        [tested.jobRunId]
      )
    ).rows;
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ status: "failed" });
    expect(nodes[0].error).toContain("Fixture dependency");
    const live = (
      await db.pg.query(
        "select status,published_version_id,trigger_once_run_id from flows where id=$1",
        [flow.id]
      )
    ).rows[0];
    expect(live).toEqual({
      status: "active",
      published_version_id: liveVersion,
      trigger_once_run_id: "run_live",
    });
  } finally {
    await db.close();
  }
});
