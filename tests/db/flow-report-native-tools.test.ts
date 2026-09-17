import { expect, it } from "vitest";
import { createAutomationAgentRunner } from "@/lib/workflows/automation-job-agent-runners";
import { buildFlowReportHandoff } from "@/lib/workflows/flow-report-handoff";
import { createAutomationDb, REPO_ID } from "./helpers/mcp-automation-fixture";

it("the actual native runner exposes scoped, repeatable report tools", async () => {
  const db = await createAutomationDb();
  const jobId = "55555555-5555-4555-8555-555555555555";
  const reportId = "66666666-6666-4666-8666-666666666666";
  const text = "evidence ".repeat(5000);
  try {
    await db.pg.query(
      "insert into flow_node_runs(id,user_id,job_run_id,status,output) values($1,'owner',$2,'success',$3)",
      [reportId, jobId, JSON.stringify({ text })]
    );
    let called = false;
    const runner = createAutomationAgentRunner({
      generateText: async (input) => {
        called = true;
        expect(input.prompt).toContain("MOGPLEX_FLOW_HANDOFF:");
        expect(input.prompt).not.toContain(text);
        const options = { toolCallId: "test", messages: [] };
        const reports = await input.tools!.listFlowReports.execute!(
          { offset: 0 },
          options
        );
        expect(reports).toMatchObject({ total: 1, nextOffset: null });
        const chunk = await input.tools!.readFlowReport.execute!(
          { reportId, offset: 20_000 },
          options
        );
        expect(chunk).toMatchObject({
          text: text.slice(20_000, 40_000),
          nextOffset: 40_000,
        });
        await expect(
          input.tools!.readFlowReport.execute!(
            { reportId: jobId, offset: 0 },
            options
          )
        ).rejects.toThrow("not available");
        return { text: "Complete", steps: [], totalUsage: {} } as never;
      },
    });
    await runner(
      {
        assignmentType: "schedule",
        skillId: null,
        agent: { model: "openai/test-model", system_prompt: null },
        repo: {
          id: REPO_ID,
          user_id: "owner",
          full_name: "acme/widgets",
          default_branch: "main",
          github_installation_id: 123,
        },
        metadata: {
          flow_node_id: "apply",
          flow_node_role: "task",
          flow_job_run_id: jobId,
          flow_reports: [
            {
              nodeId: "analyst",
              label: "Analysis",
              ...buildFlowReportHandoff(reportId, text),
            },
          ],
        },
      },
      "fixture-token",
      { model: {} as never, effectiveModelId: "openai/test-model" }
    );
    expect(called).toBe(true);
  } finally {
    await db.close();
  }
});
