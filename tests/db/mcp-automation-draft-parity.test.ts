import { expect, it } from "vitest";
import { createTestMogplexApiAutomation } from "@/lib/mogplex-api/automation-test";
import { createMogplexApiAutomation } from "@/lib/mogplex-api/automations";
import { scheduledTaskExample } from "@/lib/mogplex-api/automation-schema";
import { PRECONFIGURED_AGENTS } from "@/lib/agents/templates";
import { coerceGraph } from "@/lib/flows/graph";
import { resolveJobContext } from "@/lib/workflows/automation-job-context-resolution";
import {
  createAutomationDb,
  AGENT_ID,
  REPO_ID,
} from "./helpers/mcp-automation-fixture";

it.each([{ installationIds: undefined }, { installationIds: [] }])(
  "draft testing keeps the publication installation when scope is $installationIds",
  async ({ installationIds }) => {
    const db = await createAutomationDb();
    try {
      await db.pg.exec(`
        insert into github_installations values ('second-owned','owner',456,null);
        update repos set github_installation_id=456;
      `);
      const graph = coerceGraph(structuredClone(scheduledTaskExample));
      graph.nodes.find((node) => node.type === "start")!.data.filter = {
        scope: "all",
        installationIds,
        repos: ["acme/widgets"],
      };
      graph.nodes.find((node) => node.type === "agent")!.data.agentId =
        AGENT_ID;
      const id = (
        await db.pg.query<{ id: string }>(
          "insert into flows(user_id,installation_id,draft_graph) values('owner',123,$1) returning id",
          [JSON.stringify(graph)]
        )
      ).rows[0].id;
      let queued = 0;
      const test = createTestMogplexApiAutomation({
        enqueue: async () => {
          queued++;
          return { jobRunId: "unused", outcome: "queued", reason: null };
        },
        start: async () => ({ started: true, status: "running" }),
      });
      const request = {
        userId: "owner",
        automationId: id,
        repoId: REPO_ID,
        idempotencyKey: "installation-scope",
      };
      await expect(test(request)).rejects.toMatchObject({
        code: "REPO_SCOPE_MISMATCH",
      });
      expect(queued).toBe(0);
      expect((await db.pg.query("select id from flow_versions")).rows).toEqual(
        []
      );
      // A draft can explicitly select another installation before publishing;
      // publication adopts exactly one scoped installation in the same way.
      graph.nodes.find(
        (node) => node.type === "start"
      )!.data.filter!.installationIds = [456];
      await db.pg.query("update flows set draft_graph=$2 where id=$1", [
        id,
        JSON.stringify(graph),
      ]);
      await expect(test(request)).resolves.toMatchObject({ started: true });
      expect(queued).toBe(1);
    } finally {
      await db.close();
    }
  }
);

it("draft testing enforces the repository team's model allowlist before queueing", async () => {
  const db = await createAutomationDb();
  try {
    const team = "44444444-4444-4444-8444-444444444445";
    await db.pg
      .exec(`create table teams(id uuid primary key,model_allowlist text[]);
      create table team_members(team_id uuid,user_id text,role text);
      create table team_provider_keys(team_id uuid,provider text,created_at timestamptz,updated_at timestamptz);
      insert into teams values ('${team}',array['openai/other-model']);
      insert into team_members values ('${team}','owner','owner');
      update repos set product_team_id='${team}';`);
    const graph = coerceGraph(structuredClone(scheduledTaskExample));
    graph.nodes.find((node) => node.type === "start")!.data.filter = {
      scope: "org",
      installationIds: [123],
      repos: ["acme/widgets"],
    };
    const agent = graph.nodes.find((node) => node.type === "agent")!;
    agent.data.agentId = AGENT_ID;
    agent.data.modelOverride = "openai/test-model";
    const flow = await createMogplexApiAutomation("owner", {
      installationId: 123,
      graph,
    });
    let enqueued = false;
    const test = createTestMogplexApiAutomation({
      enqueue: async () => {
        enqueued = true;
        return { jobRunId: "unused", outcome: "queued", reason: null };
      },
      start: async () => ({ started: true, status: "running" }),
    });
    await expect(
      test({
        userId: "owner",
        automationId: flow.id,
        repoId: REPO_ID,
        idempotencyKey: "team",
      })
    ).rejects.toThrow(/not enabled and available/);
    expect(enqueued).toBe(false);
    await db.pg.query(
      "update teams set model_allowlist=array['openai/test-model'] where id=$1",
      [team]
    );
    await expect(
      test({
        userId: "owner",
        automationId: flow.id,
        repoId: REPO_ID,
        idempotencyKey: "team-allowed",
      })
    ).resolves.toMatchObject({ started: true });
    expect(enqueued).toBe(true);
  } finally {
    await db.close();
  }
});

it("legacy preset agents resolve to owned UUIDs in the test snapshot without publishing", async () => {
  const db = await createAutomationDb();
  try {
    const graph = coerceGraph(structuredClone(scheduledTaskExample));
    graph.nodes.find((node) => node.type === "start")!.data.filter = {
      scope: "org",
      installationIds: [123],
      repos: ["acme/widgets"],
    };
    graph.nodes.find((node) => node.type === "agent")!.data.agentId =
      `preset:${PRECONFIGURED_AGENTS[0].name}`;
    // Simulate a legacy saved draft which has not passed through updateFlow.
    const id = (
      await db.pg.query<{ id: string }>(
        "insert into flows(user_id,installation_id,draft_graph) values('owner',123,$1) returning id",
        [JSON.stringify(graph)]
      )
    ).rows[0].id;
    const test = createTestMogplexApiAutomation({
      enqueue: async (input) => {
        const job = (
          await db.pg.query<{ id: string }>(
            "insert into job_runs(flow_id,flow_version_id,metadata) values($1,$2,$3) returning id",
            [input.flowId, input.flowVersionId, JSON.stringify(input.metadata)]
          )
        ).rows[0];
        return { jobRunId: job.id, outcome: "queued", reason: null };
      },
      start: async () => ({ started: true, status: "running" }),
    });
    const run = await test({
      userId: "owner",
      automationId: id,
      repoId: REPO_ID,
      idempotencyKey: "legacy",
    });
    const context = await resolveJobContext(run.jobRunId!);
    expect("context" in context).toBe(true);
    const snapshot = (
      await db.pg.query<{ graph: typeof graph }>(
        "select graph from flow_versions where id=$1",
        [run.versionId]
      )
    ).rows[0].graph;
    const agentId = snapshot.nodes.find((node) => node.type === "agent")!.data
      .agentId!;
    expect(agentId).toMatch(/^[a-f0-9-]{36}$/);
    const stored = (
      await db.pg.query(
        "select status,published_version_id from flows where id=$1",
        [id]
      )
    ).rows[0];
    expect(stored).toEqual({ status: "inactive", published_version_id: null });
  } finally {
    await db.close();
  }
});
