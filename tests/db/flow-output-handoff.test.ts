import { expect, it } from "vitest";
import { coerceGraph } from "@/lib/flows/graph";
import { scheduledTaskExample } from "@/lib/mogplex-api/automation-schema";
import { createAutomationJobTask } from "@/lib/workflows/automation-job-workflow";
import {
  buildAutomationHarnessPrompt,
  buildPromptForJob,
} from "@/lib/workflows/automation-job-prompts";
import type { JobContext } from "@/lib/workflows/automation-job-types";
import {
  createAutomationDb,
  AGENT_ID,
  REPO_ID,
} from "./helpers/mcp-automation-fixture";

it.each(["mogplex", "claude-code"] as const)(
  "%s passes a trailing verdict intact to the next node and stores full output",
  async (harness) => {
    const db = await createAutomationDb();
    const analysis = `${"Detailed evidence. ".repeat(100)}\nDECISION: NO_ACTION`;
    try {
      const graph = coerceGraph(structuredClone(scheduledTaskExample));
      const apply = graph.nodes.find((node) => node.type === "agent")!;
      apply.data.harness = harness;
      apply.data.agentId = harness === "mogplex" ? AGENT_ID : null;
      apply.data.modelOverride = null;
      const analyst = structuredClone(apply);
      analyst.id = "analyst";
      analyst.data.label = "Analysis";
      analyst.data.role = "review";
      graph.nodes.splice(1, 0, analyst);
      graph.edges = [
        { id: "start-analysis", source: "start", target: "analyst" },
        { id: "analysis-apply", source: "analyst", target: apply.id },
        { id: "apply-end", source: apply.id, target: "end" },
      ];
      const flowId = (
        await db.pg.query<{ id: string }>(
          "insert into flows(user_id,installation_id,draft_graph) values('owner',123,$1) returning id",
          [JSON.stringify(graph)]
        )
      ).rows[0].id;
      const versionId = (
        await db.pg.query<{ id: string }>(
          "insert into flow_versions(flow_id,version_number,graph) values($1,1,$2) returning id",
          [flowId, JSON.stringify(graph)]
        )
      ).rows[0].id;
      const jobId = (
        await db.pg.query<{ id: string }>(
          "insert into job_runs(flow_id,flow_version_id,metadata) values($1,$2,$3) returning id",
          [
            flowId,
            versionId,
            JSON.stringify({ source_type: "schedule", repo_id: REPO_ID }),
          ]
        )
      ).rows[0].id;
      const prompts: string[] = [];
      const resultFor = (context: JobContext, prompt: string) => {
        if (context.metadata.flow_node_id === "analyst")
          return { text: analysis, steps: [], usage: null };
        prompts.push(prompt);
        expect(context.metadata.flow_previous_outputs).toEqual([
          { label: "Analysis", output: analysis },
        ]);
        expect(prompt).toContain(analysis);
        return {
          text: "NO_ACTION: skipped applying changes",
          steps: [],
          usage: null,
        };
      };
      const run = createAutomationJobTask({
        resolveGithubToken: async () => "fixture-token",
        resolveAutomationModel: async (_userId, modelId) => ({
          model: {} as never,
          effectiveModelId: modelId,
        }),
        runAutomationAgent: async (context) =>
          resultFor(
            context,
            buildPromptForJob(
              context.assignmentType,
              context.metadata,
              context.agent.system_prompt
            ).prompt
          ),
        runAutomationHarnessAgent: async (input) =>
          resultFor(input.context, buildAutomationHarnessPrompt(input)),
        getDurationMs: async () => 10,
        persistJobSuccess: async () => true,
        persistJobFailure: async () => true,
        tryLogAiCall: async () => null,
        recordControlDispatchEvent: async () => {},
        releaseQueuedJobs: async () => [],
        isJobRunCancellationRequested: async () => false,
        throwIfJobRunCancelled: async () => {},
      });
      const outcome = await run({
        jobRunId: jobId,
        startedAt: new Date().toISOString(),
        releasedScope: {
          sourceKind: "flow",
          sourceType: "schedule",
          sourceId: flowId,
          repoId: REPO_ID,
          installationId: 123,
        },
      });
      expect(outcome.success, JSON.stringify(outcome)).toBe(true);
      expect(prompts).toHaveLength(1);
      const stored = (
        await db.pg.query<{ output: { text: string; text_summary: string } }>(
          "select output from flow_node_runs where node_id='analyst'"
        )
      ).rows[0].output;
      expect(stored.text).toBe(analysis);
      expect(stored.text_summary).toHaveLength(600);
    } finally {
      await db.close();
    }
  }
);
