import assert from "node:assert/strict";
import test from "node:test";
import type { FlowGraph } from "../../lib/types";
import { loadAutomationJobWorkflowModule } from "./helpers/automation-job-fixtures";

const recoverNode = {
  id: "recover-1",
  type: "set_variable" as const,
  position: { x: 480, y: 180 },
  data: {
    label: "Record failure",
    assignments: [{ key: "status", template: "failed" }],
  },
};
const startNode = {
  id: "start-1",
  type: "start" as const,
  position: { x: 0, y: 0 },
  data: { label: "Start", event: "issue_opened" as const },
};
const endNode = {
  id: "end-1",
  type: "end" as const,
  position: { x: 720, y: 0 },
  data: { label: "Done" },
};

// Runs a flow whose middle node has an error edge to `recover-1`, and reports
// how each node run ended.
async function runFlow(graph: FlowGraph) {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();
  const originalFetch = globalThis.fetch;
  const statuses = new Map<string, string>();
  let failure: string | null = null;

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: { source_type: "issue_opened" },
        assignmentType: "issue_triage",
        skillId: null,
        agent: { model: "openai/gpt-5.4", system_prompt: null },
        repo: {
          id: "repo-error-edge",
          user_id: "user-error-edge",
          full_name: "acme/widgets",
          default_branch: "main",
          github_installation_id: 77,
        },
      },
      flow: {
        flowId: "flow-error-edge",
        flowVersionId: "flow-version-error-edge",
        graph,
        agentsById: new Map(),
      },
    }),
    resolveGithubToken: async () => "github-token",
    runFlowAction: async () => ({ summary: "sent", output: {} }),
    getDurationMs: async () => 10,
    persistJobSuccess: async () => true,
    persistJobFailure: async (input: { error?: string }) => {
      failure = input.error ?? "failed";
      return true;
    },
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
    if (!requestUrl.startsWith("https://example.supabase.co")) {
      throw new Error(`Unexpected fetch in test: ${method} ${requestUrl}`);
    }
    if (requestUrl.includes("/rest/v1/flow_node_runs")) {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
      if (method === "POST") {
        return Response.json(
          { id: String(body.node_id), started_at: "2026-09-19T16:00:00.000Z" },
          { status: 201 }
        );
      }
      if (method === "PATCH") {
        const id = /id=eq\.([^&]+)/.exec(requestUrl)?.[1] ?? "";
        statuses.set(decodeURIComponent(id), String(body.status));
        return Response.json({ id }, { status: 200 });
      }
    }
    return Response.json([], { status: 200 });
  };

  try {
    const result = await workflow({
      jobRunId: "job-error-edge",
      startedAt: "2026-09-19T16:00:00.000Z",
      releasedScope: {
        sourceKind: "flow",
        sourceType: "issue_opened",
        sourceId: "flow-error-edge",
        repoId: "repo-error-edge",
        installationId: 77,
      },
    });
    return { result, statuses, failure };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("a node that succeeds does not run its error branch", async () => {
  const { result, statuses } = await runFlow({
    nodes: [
      startNode,
      {
        id: "action-1",
        type: "action",
        position: { x: 240, y: 0 },
        data: {
          label: "Notify",
          operation: "slack.send_message",
          destination: "channel",
          teamId: "T123",
          channelId: "C123",
          channelName: "alerts",
          message: "Build passed",
          unfurlLinks: false,
        },
      },
      recoverNode,
      endNode,
    ],
    edges: [
      { id: "e1", source: "start-1", target: "action-1" },
      { id: "e2", source: "action-1", target: "end-1" },
      {
        id: "e3",
        source: "action-1",
        target: "recover-1",
        sourceHandle: "error",
      },
      { id: "e4", source: "recover-1", target: "end-1" },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  });

  assert.equal(result.success, true);
  assert.equal(statuses.get("action-1"), "success");
  assert.equal(statuses.get("recover-1"), "skipped");
  assert.equal(statuses.get("end-1"), "success");
});

test("a condition with an error branch still reaches the end node", async () => {
  const { result, statuses, failure } = await runFlow({
    nodes: [
      startNode,
      {
        id: "if-1",
        type: "condition",
        position: { x: 240, y: 0 },
        data: {
          label: "Is issue",
          mode: "all",
          rules: [
            {
              field: "metadata.source_type",
              operator: "equals",
              value: "issue_opened",
            },
          ],
        },
      },
      recoverNode,
      endNode,
    ],
    edges: [
      { id: "e1", source: "start-1", target: "if-1" },
      { id: "e2", source: "if-1", target: "end-1", sourceHandle: "true" },
      { id: "e3", source: "if-1", target: "end-1", sourceHandle: "false" },
      { id: "e4", source: "if-1", target: "recover-1", sourceHandle: "error" },
      { id: "e5", source: "recover-1", target: "end-1" },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  });

  assert.equal(failure, null);
  assert.equal(result.success, true);
  assert.equal(statuses.get("if-1"), "success");
  assert.equal(statuses.get("recover-1"), "skipped");
  assert.equal(statuses.get("end-1"), "success");
});
