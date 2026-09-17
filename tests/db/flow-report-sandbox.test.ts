import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createAutomationDb, REPO_ID } from "./helpers/mcp-automation-fixture";
import { buildFlowReportHandoff } from "@/lib/workflows/flow-report-handoff";
import type { JobContext } from "@/lib/workflows/automation-job-types";

const provider = vi.hoisted(() => ({
  files: new Map<string, string>(),
  failWrites: false,
}));
vi.mock("@vercel/sandbox", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@vercel/sandbox")>()),
  Sandbox: {
    get: async () => ({
      writeFiles: async (files: { path: string; content: Buffer }[]) => {
        if (provider.failWrites) throw new Error("Provider write failed");
        for (const file of files)
          provider.files.set(file.path, file.content.toString("utf8"));
      },
    }),
  },
}));
beforeAll(() => {
  vi.stubEnv("INTERNAL_API_SECRET", "fixture-internal-secret");
  vi.stubEnv("PLATFORM_VERCEL_TOKEN", "fixture-platform-token");
  vi.stubEnv("PLATFORM_VERCEL_PROJECT_ID", "fixture-project");
});
afterAll(() => vi.unstubAllEnvs());

it.each(["success", "foreign", "pending", "write-failure"])(
  "materializes reports through owned sandbox loading: %s",
  async (scenario) => {
    const { prepareHarnessFlowReports } =
      await import("@/lib/workflows/flow-report-sandbox");
    const db = await createAutomationDb();
    const jobId = "55555555-5555-4555-8555-555555555555";
    const reportId = "66666666-6666-4666-8666-666666666666";
    const sandboxId = "77777777-7777-4777-8777-777777777777";
    const text = "Unicode evidence: \u{1F680}\n".repeat(50_000);
    const context: JobContext = {
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
        flow_job_run_id: jobId,
        flow_reports: [
          {
            nodeId: "analyst",
            label: "Analysis",
            ...buildFlowReportHandoff(reportId, text),
          },
        ],
      },
    };
    provider.files.clear();
    provider.failWrites = scenario === "write-failure";
    try {
      await db.pg.exec(`
        alter table profiles add column vercel_team_id text,
          add column default_vercel_project_id text, add column default_vercel_team_id text;
        alter table repos add column root_directory text;
        create table sandboxes(id uuid primary key, user_id text, sandbox_id text,
          repo_id uuid references repos(id), root_directory text, billing_source text,
          billing_team_id text, billing_project_id text, vercel_team_id text, vercel_project_id text);
      `);
      await db.pg.query(
        "insert into sandboxes(id,user_id,sandbox_id,repo_id,billing_source) values($1,$2,$3,$4,'platform')",
        [
          sandboxId,
          scenario === "foreign" ? "other" : "owner",
          scenario === "pending" ? "pending" : "sandbox-live",
          REPO_ID,
        ]
      );
      await db.pg.query(
        "insert into flow_node_runs(id,user_id,job_run_id,status,output) values($1,'owner',$2,'success',$3)",
        [reportId, jobId, JSON.stringify({ text })]
      );
      const operation = prepareHarnessFlowReports(context, {
        recordId: sandboxId,
        sandboxId: "sandbox-live",
        rootDirectory: null,
      });
      if (scenario === "success") {
        await operation;
        const manifest = provider.files.get(
          String(context.metadata.flow_report_manifest)
        );
        expect(manifest).toBeDefined();
        const entry = JSON.parse(manifest!);
        expect(entry.reportId).toBe(reportId);
        expect(entry.path).toBe(
          `/tmp/mogplex-flow-reports/${jobId}/${reportId}.txt`
        );
        expect(provider.files.get(entry.path)).toBe(text);
      } else {
        await expect(operation).rejects.toThrow(
          scenario === "foreign"
            ? "Not found"
            : scenario === "pending"
              ? "not ready"
              : "Provider write failed"
        );
        expect(context.metadata.flow_report_manifest).toBeUndefined();
        expect(provider.files.size).toBe(0);
      }
    } finally {
      await db.close();
    }
  }
);
