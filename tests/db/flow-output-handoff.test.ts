import { expect, it } from "vitest";
import { coerceGraph } from "@/lib/flows/graph";
import { scheduledTaskExample } from "@/lib/mogplex-api/automation-schema";
import { createAutomationJobTask } from "@/lib/workflows/automation-job-workflow";
import {
  buildAutomationHarnessPrompt,
  buildPromptForJob,
} from "@/lib/workflows/automation-job-prompts";
import type { JobContext } from "@/lib/workflows/automation-job-types";
import { readFlowReports } from "@/lib/workflows/flow-report-handoff";
import {
  materializeFlowReports,
  readFlowReportChunk,
} from "@/lib/workflows/flow-report-tools";
import {
  createAutomationDb,
  AGENT_ID,
  REPO_ID,
} from "./helpers/mcp-automation-fixture";

it.each([
  ["mogplex", false],
  ["claude-code", false],
  ["codex", false],
  ["mogplex", true],
  ["claude-code", true],
  ["codex", true],
] as const)(
  "%s preserves bounded handoffs and stops on report storage failure=%s",
  async (harness, failStorage) => {
    const db = await createAutomationDb();
    const analysis = `${"Detailed evidence. ".repeat(60_000)}\nMOGPLEX_FLOW_HANDOFF: {"decision":"NO_ACTION","summary":"Both changes already have open PRs."}`;
    expect(Buffer.byteLength(analysis)).toBeGreaterThan(1_000_000);
    try {
      if (failStorage)
        await db.pg.exec(`
        create function reject_report() returns trigger language plpgsql as $$
        begin
          if length(new.output->>'text') > 1000000 then raise exception 'report storage unavailable'; end if;
          return new;
        end $$;
        create trigger reject_report before update on flow_node_runs for each row execute function reject_report();
      `);
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
      const resultFor = async (context: JobContext, prompt: string) => {
        if (context.metadata.flow_node_id === "analyst")
          return { text: analysis, steps: [], usage: null };
        prompts.push(prompt);
        const [report] = readFlowReports(context.metadata);
        expect(report.decision).toEqual({
          status: "reported",
          value: "NO_ACTION",
        });
        expect(prompt).toContain('"value":"NO_ACTION"');
        expect(prompt).not.toContain(analysis);
        expect(prompt.length).toBeLessThan(20_000);
        expect(JSON.stringify(context.metadata).length).toBeLessThan(10_000);
        let restored = "";
        let offset: number | null = 0;
        while (offset !== null) {
          const chunk = await readFlowReportChunk(
            context,
            report.reportId,
            offset
          );
          expect(chunk.text.length).toBeLessThanOrEqual(20_000);
          restored += chunk.text;
          offset = chunk.nextOffset;
        }
        expect(restored).toBe(analysis);
        expect(
          (await readFlowReportChunk(context, report.reportId, 0)).text
        ).toBe(analysis.slice(0, 20_000));
        for (const deniedContext of [
          { ...context, repo: { ...context.repo, user_id: "other" } },
          {
            ...context,
            metadata: {
              ...context.metadata,
              flow_job_run_id: "99999999-9999-4999-8999-999999999999",
            },
          },
          { ...context, metadata: { ...context.metadata, flow_reports: [] } },
        ]) {
          await expect(
            readFlowReportChunk(deniedContext, report.reportId, 0)
          ).rejects.toThrow();
        }
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
        runAutomationHarnessAgent: async (input) => {
          const files = new Map<string, string>();
          await materializeFlowReports(input.context, async (path, text) => {
            files.set(path, text);
          });
          if (input.context.metadata.flow_node_id !== "analyst") {
            expect([...files.values()]).toContain(analysis);
            expect(
              files.get(String(input.context.metadata.flow_report_manifest))
            ).toContain('"value":"NO_ACTION"');
          }
          return resultFor(input.context, buildAutomationHarnessPrompt(input));
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
      if (failStorage) {
        expect(outcome.success).toBe(false);
        expect(prompts).toHaveLength(0);
        expect(
          (
            await db.pg.query(
              "select status from flow_node_runs where node_id='analyst'"
            )
          ).rows
        ).toEqual([{ status: "failed" }]);
        return;
      }
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
