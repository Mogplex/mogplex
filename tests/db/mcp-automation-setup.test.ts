import { expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { MogplexApiClient } from "@/lib/mogplex-api/client";
import { createMogplexMcpPostHandler } from "@/app/api/v1/mogplex/mcp/route";
import { createAutomationValidateHandler } from "@/app/api/v1/mogplex/automations/validate/route";
import { createMogplexApiAutomationsPostHandler } from "@/app/api/v1/mogplex/automations/route";
import { createMogplexApiAutomationPublishPostHandler } from "@/app/api/v1/mogplex/automations/[automationId]/publish/route";
import { resolveJobContext } from "@/lib/workflows/automation-job-context-resolution";
import { createAutomationJobTask } from "@/lib/workflows/automation-job-workflow";
import { buildAutomationHarnessPrompt } from "@/lib/workflows/automation-job-prompts";
import type { FlowGraph } from "@/lib/types";
import { createAutomationDb, REPO_ID } from "./helpers/mcp-automation-fixture";

const auth = async () => ({
  ok: true as const,
  auth: { userId: "owner", keyId: "test", scopes: ["read", "write"] },
});

it("MCP discovers, validates, creates, publishes and executes a scheduled task without a PR or stored agent", async () => {
  const db = await createAutomationDb();
  const schedules: string[] = [];
  const oldKey = process.env.TRIGGER_SECRET_KEY;
  process.env.TRIGGER_SECRET_KEY = "tr_dev_test";
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (!url.hostname.endsWith("trigger.dev"))
        throw new Error(`Unexpected external request: ${url}`);
      schedules.push(`${init?.method ?? "GET"} ${url.pathname}`);
      return Response.json({
        id: "sched_test",
        task: "workflow-schedule",
        active: true,
        type: "IMPERATIVE",
        deduplicationKey: "test",
        externalId: "test",
        generator: {
          type: "CRON",
          expression: "10 7 * * *",
          description: "Daily",
        },
        timezone: "UTC",
        nextRun: "2026-09-18T07:10:00.000Z",
        environments: [],
      });
    }
  );
  try {
    const validate = createAutomationValidateHandler({ resolveApiKey: auth });
    const create = createMogplexApiAutomationsPostHandler({
      resolveApiKey: auth,
    });
    const publish = createMogplexApiAutomationPublishPostHandler({
      resolveApiKey: auth,
    });
    const client = new MogplexApiClient({
      baseUrl: "https://mogplex.test",
      authorization: "mog_test",
      fetch: async (url, init) => {
        const request = new NextRequest(String(url), {
          ...init,
          signal: init?.signal ?? undefined,
        });
        const pathname = new URL(String(url)).pathname;
        if (pathname.endsWith("/validate")) return validate(request);
        if (pathname.endsWith("/publish"))
          return publish(request, {
            params: Promise.resolve({
              automationId: pathname.split("/").at(-2)!,
            }),
          });
        if (pathname.endsWith("/automations")) return create(request);
        throw new Error(`Unexpected API request ${pathname}`);
      },
    });
    const mcp = createMogplexMcpPostHandler({
      resolveApiKey: auth,
      createClient: () => client,
    });
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const response = await mcp(
        new NextRequest("https://mogplex.test/api/v1/mogplex/mcp", {
          method: "POST",
          headers: { authorization: "Bearer mog_test" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: name,
            method: "tools/call",
            params: { name, arguments: args },
          }),
        })
      );
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.error).toBeUndefined();
      return payload.result;
    };
    const guide = await call("mogplex_get_automation_schema");
    const graph: FlowGraph = guide.structuredContent.examples.scheduledTask;
    const start = graph.nodes.find((node) => node.type === "start")!;
    start.data.filter = {
      scope: "org",
      installationIds: [123],
      repos: ["acme/widgets"],
    };
    const task = graph.nodes.find((node) => node.type === "agent")!;
    task.data.harness = "claude-code";
    task.data.agentId = null;
    task.data.modelOverride = null;
    const before = db.statements.length;
    const validation = await call("mogplex_validate_automation", {
      installationId: 123,
      graph,
    });
    expect(validation.structuredContent.validation).toEqual({
      valid: true,
      errors: [],
    });
    expect(
      db.statements
        .slice(before)
        .every((sql) => !/^(insert|update|delete)\b/i.test(sql.trim()))
    ).toBe(true);
    expect(schedules).toHaveLength(0);

    const bad = structuredClone(graph);
    bad.nodes.find((node) => node.type === "agent")!.data.role = "edit";
    const rejected = await call("mogplex_validate_automation", {
      installationId: 123,
      graph: bad,
    });
    expect(rejected.isError).toBe(true);
    expect(rejected.structuredContent.validation.errors.join(" ")).toMatch(
      /existing pull request/
    );

    const created = await call("mogplex_create_automation", {
      installationId: 123,
      name: "Daily maintenance",
      graph,
    });
    expect(created.isError, JSON.stringify(created)).toBe(false);
    const id = created.structuredContent.automation.id;
    const published = await call("mogplex_publish_automation", {
      automationId: id,
    });
    expect(published.isError, JSON.stringify(published)).toBe(false);
    expect(published.structuredContent.automation.status).toBe("active");
    expect(schedules.some((url) => url.includes("schedules"))).toBe(true);
    const stored = (
      await db.pg.query<{
        published_version_id: string;
        trigger_schedule_id: string;
      }>(
        "select published_version_id, trigger_schedule_id from flows where id=$1",
        [id]
      )
    ).rows[0];
    expect(stored.trigger_schedule_id).toBe("sched_test");
    const job = (
      await db.pg.query<{ id: string }>(
        "insert into job_runs(flow_id,flow_version_id,metadata) values($1,$2,$3) returning id",
        [
          id,
          stored.published_version_id,
          JSON.stringify({ source_type: "schedule", repo_id: REPO_ID }),
        ]
      )
    ).rows[0];
    const resolved = await resolveJobContext(job.id);
    expect("context" in resolved).toBe(true);
    if (!("context" in resolved)) throw new Error(JSON.stringify(resolved));
    expect(resolved.context.agent.model).toBe("harness:claude-code");
    const executions: string[] = [];
    const run = createAutomationJobTask({
      resolveGithubToken: async () => "fixture-token",
      runAutomationHarnessAgent: async (input) => {
        const prompt = buildAutomationHarnessPrompt(input);
        expect(input.context.metadata.flow_node_role).toBe("task");
        expect(input.pullRequest).toBeNull();
        expect(prompt).toContain("prepared task branch");
        expect(prompt).not.toContain("MOGPLEX_REVIEW_RESULT:");
        executions.push(input.context.repo.full_name);
        return {
          text: "NO_ACTION: repository already meets the requested state.",
          steps: [],
          usage: null,
        };
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
      jobRunId: job.id,
      startedAt: new Date().toISOString(),
      releasedScope: {
        sourceKind: "flow",
        sourceType: "schedule",
        sourceId: id,
        repoId: REPO_ID,
        installationId: 123,
      },
    });
    expect(outcome.success, JSON.stringify(outcome)).toBe(true);
    expect(executions).toEqual(["acme/widgets"]);
    const nodeRuns = (
      await db.pg.query<{ status: string; output: { role: string } }>(
        "select status,output from flow_node_runs where node_type='agent'"
      )
    ).rows;
    expect(nodeRuns).toHaveLength(1);
    expect(nodeRuns[0].status).toBe("success");
    expect(nodeRuns[0].output.role).toBe("task");
  } finally {
    vi.unstubAllGlobals();
    if (oldKey === undefined) delete process.env.TRIGGER_SECRET_KEY;
    else process.env.TRIGGER_SECRET_KEY = oldKey;
    await db.close();
  }
}, 30_000);
