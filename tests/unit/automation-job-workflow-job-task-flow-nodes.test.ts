import assert from "node:assert/strict";
import test from "node:test";
import {
  type CapturedControlDispatchEvent,
  loadAutomationJobWorkflowModule,
} from "./helpers/automation-job-fixtures";

test("createAutomationJobTask persists flow_node_runs for every operator node type", async () => {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();

  const originalFetch = globalThis.fetch;
  let nodeRunSequence = 0;
  const insertedNodeTypes: string[] = [];
  let controlDispatchEvent: CapturedControlDispatchEvent | null = null;
  let persistedSuccess = false;

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: {
          issue_number: 21,
          issue_title: "Operator persistence regression fixture",
          package: "web",
        },
        assignmentType: "issue_triage",
        skillId: null,
        agent: {
          model: "openai/gpt-5.4",
          system_prompt: null,
        },
        repo: {
          id: "repo-123",
          user_id: "user-123",
          full_name: "acme/widgets",
          default_branch: "main",
          github_installation_id: 123,
        },
      },
      flow: {
        flowId: "flow-operators",
        flowVersionId: "flow-version-operators",
        graph: {
          nodes: [
            {
              id: "start-1",
              type: "start",
              position: { x: 0, y: 0 },
              data: {
                label: "Start",
                event: "issue_opened",
                isDefault: false,
              },
            },
            {
              id: "condition-1",
              type: "condition",
              position: { x: 240, y: 0 },
              data: {
                label: "If never set",
                mode: "all",
                rules: [
                  {
                    field: "metadata.never_set",
                    operator: "exists",
                    value: "",
                  },
                ],
              },
            },
            {
              id: "parallel-1",
              type: "parallel",
              position: { x: 480, y: 120 },
              data: {
                label: "Fan out",
              },
            },
            {
              id: "delay-a",
              type: "delay",
              position: { x: 720, y: 60 },
              data: {
                label: "Wait A",
                duration: 0,
                unit: "seconds",
              },
            },
            {
              id: "delay-b",
              type: "delay",
              position: { x: 720, y: 180 },
              data: {
                label: "Wait B",
                duration: 0,
                unit: "seconds",
              },
            },
            {
              id: "join-1",
              type: "join",
              position: { x: 960, y: 120 },
              data: {
                label: "Merge",
                policy: "wait_for_all",
              },
            },
            {
              id: "end-1",
              type: "end",
              position: { x: 1200, y: 0 },
              data: {
                label: "Done",
              },
            },
            {
              id: "action-1",
              type: "action",
              position: { x: 1080, y: 120 },
              data: {
                label: "Test package",
                operation: "sandbox.run_command",
                command: "pnpm --filter web test",
                workingDirectory: null,
              },
            },
          ],
          edges: [
            {
              id: "edge-start-condition",
              source: "start-1",
              target: "condition-1",
            },
            {
              id: "edge-condition-end",
              source: "condition-1",
              target: "end-1",
              sourceHandle: "true",
            },
            {
              id: "edge-condition-parallel",
              source: "condition-1",
              target: "parallel-1",
              sourceHandle: "false",
            },
            {
              id: "edge-parallel-delay-a",
              source: "parallel-1",
              target: "delay-a",
            },
            {
              id: "edge-parallel-delay-b",
              source: "parallel-1",
              target: "delay-b",
            },
            {
              id: "edge-delay-a-join",
              source: "delay-a",
              target: "join-1",
            },
            {
              id: "edge-delay-b-join",
              source: "delay-b",
              target: "join-1",
            },
            {
              id: "edge-join-action",
              source: "join-1",
              target: "action-1",
            },
            {
              id: "edge-action-end",
              source: "action-1",
              target: "end-1",
            },
          ],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        agentsById: new Map(),
      },
    }),
    resolveGithubToken: async () => "github-token",
    runAutomationAgent: async () => {
      throw new Error("runAutomationAgent should not be called");
    },
    runFlowAction: async ({ action }) => {
      assert.equal(action.operation, "sandbox.run_command");
      assert.equal(action.command, "pnpm --filter web test");
      return {
        summary: "Command completed",
        output: { exit_code: 0, stdout: "ok" },
      };
    },
    getDurationMs: async () => 99,
    persistJobSuccess: async () => {
      persistedSuccess = true;
      return true;
    },
    tryLogAiCall: async () => null,
    recordControlDispatchEvent: async (input) => {
      controlDispatchEvent = {
        outcome: input.outcome,
        reason: input.reason,
        metadata: input.metadata,
      };
    },
    releaseQueuedJobs: async () => [],
    isJobRunCancellationRequested: async () => false,
    throwIfJobRunCancelled: async () => {},
    persistJobFailure: async () => {
      throw new Error("persistJobFailure should not be called");
    },
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
      if (method === "POST") {
        const body =
          typeof init?.body === "string" ? JSON.parse(init.body) : {};
        if (typeof body.node_type === "string") {
          insertedNodeTypes.push(body.node_type);
        }
        nodeRunSequence += 1;
        return Response.json(
          {
            id: `node-run-${nodeRunSequence}`,
            started_at: "2026-04-30T21:00:00.000Z",
          },
          { status: 201 }
        );
      }

      if (method === "PATCH") {
        return Response.json({ id: "node-run-updated" }, { status: 200 });
      }
    }

    return Response.json([], { status: 200 });
  };

  try {
    const result = await workflow({
      jobRunId: "job-flow-operator-persistence",
      startedAt: "2026-04-30T21:00:00.000Z",
      releasedScope: {
        sourceKind: "flow",
        sourceType: "issue_opened",
        sourceId: "flow-operators",
        repoId: "repo-123",
        installationId: 123,
      },
    });

    assert.equal(result.success, true);
    assert.equal(persistedSuccess, true);
    const capturedDispatch =
      controlDispatchEvent as unknown as CapturedControlDispatchEvent | null;
    assert.equal(capturedDispatch?.outcome, "completed");

    const seen = new Set(insertedNodeTypes);
    for (const expected of [
      "start",
      "condition",
      "parallel",
      "delay",
      "join",
      "action",
      "end",
    ]) {
      assert.ok(
        seen.has(expected),
        `expected flow_node_runs insert with node_type "${expected}", saw ${JSON.stringify(insertedNodeTypes)}`
      );
    }
    // delay fan-out emits two delay rows
    const delayCount = insertedNodeTypes.filter(
      (type) => type === "delay"
    ).length;
    assert.equal(delayCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
