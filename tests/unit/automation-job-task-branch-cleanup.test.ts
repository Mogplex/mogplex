import assert from "node:assert/strict";
import test from "node:test";
import { loadAutomationJobWorkflowModule } from "./helpers/automation-job-fixtures";

/**
 * A scheduled task node that changes nothing must not leave its boot-pushed
 * `mogplex/task-*` branch on the repository (webrenew/vmotif had 33 of them).
 */
test("a scheduled task node that pushes nothing deletes its empty task branch", async () => {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();
  const { taskWorkingBranch } =
    await import("../../lib/workflows/automation-task-sandbox");
  const originalFetch = globalThis.fetch;
  let nodeRunSequence = 0;
  let branchUsedByRun: string | null = null;
  const githubCalls: string[] = [];

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: { source_type: "schedule" },
        assignmentType: "cron",
        skillId: null,
        agent: { model: "openai/gpt-5.4", system_prompt: null },
        repo: {
          id: "repo-123",
          user_id: "user-123",
          full_name: "acme/widgets",
          default_branch: "main",
          github_installation_id: 123,
        },
      },
      flow: {
        flowId: "flow-task",
        flowVersionId: "flow-version-task",
        graph: {
          nodes: [
            {
              id: "start-1",
              type: "start",
              position: { x: 0, y: 0 },
              data: {
                label: "Start",
                event: "schedule",
                scheduleCron: "0 9 * * 1",
                isDefault: false,
              },
            },
            {
              id: "task-1",
              type: "agent",
              position: { x: 240, y: 0 },
              data: {
                label: "Nightly chores",
                agentId: null,
                harness: "codex",
                role: "task",
                systemPromptOverride: "Tidy the repository if needed.",
              },
            },
            {
              id: "end-1",
              type: "end",
              position: { x: 480, y: 0 },
              data: { label: "End" },
            },
          ],
          edges: [
            { id: "edge-start-task", source: "start-1", target: "task-1" },
            { id: "edge-task-end", source: "task-1", target: "end-1" },
          ],
        },
        agentsById: new Map(),
      },
    }),
    resolveGithubToken: async () => "github-token",
    runAutomationHarnessAgent: async (input) => {
      branchUsedByRun = taskWorkingBranch(input.context);
      return { text: "Nothing needed changing.", usage: null, steps: [] };
    },
    persistJobSuccess: async () => true,
    persistJobFailure: async () => true,
    getDurationMs: async () => 10,
    tryLogAiCall: async () => null,
    recordControlDispatchEvent: async () => {},
    releaseQueuedJobs: async () => [],
    isJobRunCancellationRequested: async () => false,
    throwIfJobRunCancelled: async () => {},
  });

  globalThis.fetch = async (input, init) => {
    const requestUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    if (requestUrl.startsWith("https://api.github.com/")) {
      const path = new URL(requestUrl).pathname;
      githubCalls.push(`${method} ${path}`);
      if (path.includes("/compare/")) return Response.json({ ahead_by: 0 });
      if (path.endsWith("/pulls")) return Response.json([]);
      if (method === "DELETE") return new Response(null, { status: 204 });
    }
    if (requestUrl.includes("/rest/v1/flow_node_runs")) {
      nodeRunSequence += 1;
      return Response.json(
        {
          id: `node-run-${nodeRunSequence}`,
          started_at: "2026-10-13T09:00:00.000Z",
        },
        { status: method === "POST" ? 201 : 200 }
      );
    }
    if (requestUrl.includes("/rest/v1/job_runs")) {
      return Response.json({
        status: "running",
        cancel_requested_at: null,
        cancelled_at: null,
      });
    }
    if (requestUrl.startsWith("https://example.supabase.co")) {
      return Response.json([]);
    }
    throw new Error(`Unexpected fetch in test: ${method} ${requestUrl}`);
  };

  try {
    await workflow({
      jobRunId: "job-task-cleanup",
      startedAt: "2026-10-13T09:00:00.000Z",
      releasedScope: {
        sourceKind: "flow",
        sourceType: "schedule",
        sourceId: "flow-task",
        repoId: "repo-123",
        installationId: 123,
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.match(branchUsedByRun ?? "", /^mogplex\/task-[\da-f-]{36}$/);
  assert.ok(
    githubCalls.includes(
      `DELETE /repos/acme/widgets/git/refs/heads/${branchUsedByRun}`
    ),
    `expected the empty task branch to be deleted; GitHub saw: ${githubCalls.join(", ")}`
  );
});
