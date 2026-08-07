import assert from "node:assert/strict";
import test from "node:test";
import { loadAutomationJobWorkflowModule } from "./helpers/automation-job-fixtures";

test("createAutomationJobTask fails an await_event node when the wait times out", async () => {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();

  const originalFetch = globalThis.fetch;
  const completedStatuses: Array<{
    status: string;
    error: string | null;
  }> = [];
  const finalizeWaitCalls: Array<{ waitId: string; status: string }> = [];
  let persistFailureCalled = false;

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: { source_type: "pr_opened" },
        assignmentType: "pr_review",
        skillId: null,
        agent: { model: "openai/gpt-5.4", system_prompt: null },
        repo: {
          id: "repo-timeout",
          user_id: "user-timeout",
          full_name: "acme/widgets",
          github_installation_id: 88,
        },
      },
      flow: {
        flowId: "flow-timeout",
        flowVersionId: "flow-version-timeout",
        graph: {
          nodes: [
            {
              id: "start-1",
              type: "start",
              position: { x: 0, y: 0 },
              data: { label: "Start", event: "pr_opened", isDefault: false },
            },
            {
              id: "await-1",
              type: "await_event",
              position: { x: 240, y: 0 },
              data: {
                label: "Wait",
                config: {
                  kind: "github_label_added",
                  labelName: "ship",
                  prOnly: true,
                },
                timeout: { value: 5, unit: "minutes" },
              },
            },
            {
              id: "end-1",
              type: "end",
              position: { x: 480, y: 0 },
              data: { label: "Done" },
            },
          ],
          edges: [
            { id: "e1", source: "start-1", target: "await-1" },
            { id: "e2", source: "await-1", target: "end-1" },
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
    getDurationMs: async () => 99,
    persistJobSuccess: async () => {
      throw new Error("persistJobSuccess should not be called on timeout");
    },
    tryLogAiCall: async () => null,
    recordControlDispatchEvent: async () => {},
    releaseQueuedJobs: async () => [],
    isJobRunCancellationRequested: async () => false,
    throwIfJobRunCancelled: async () => {},
    persistJobFailure: async () => {
      persistFailureCalled = true;
      return true;
    },
    waitProvider: {
      sleep: async () => {},
      createToken: async () => ({ id: "tok-timeout-1" }),
      waitForToken: async () => ({
        ok: false,
        reason: "timeout",
        message: "wait expired",
      }),
    },
    waitStore: {
      createWait: async () => ({ id: "wait-row-2" }),
      finalizeWait: async (input) => {
        finalizeWaitCalls.push(input);
      },
    },
  });

  globalThis.fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    const method = (init?.method ?? "GET").toUpperCase();
    if (!url.startsWith("https://example.supabase.co")) {
      throw new Error(`Unexpected fetch in test: ${method} ${url}`);
    }
    if (url.includes("/rest/v1/flow_node_runs")) {
      if (method === "POST") {
        return Response.json(
          { id: "node-run-1", started_at: new Date().toISOString() },
          { status: 201 }
        );
      }
      if (method === "PATCH") {
        const body =
          typeof init?.body === "string" ? JSON.parse(init.body) : {};
        if (typeof body.status === "string") {
          completedStatuses.push({
            status: body.status,
            error: typeof body.error === "string" ? body.error : null,
          });
        }
        return Response.json({ id: "node-run-updated" }, { status: 200 });
      }
    }
    return Response.json([], { status: 200 });
  };

  try {
    const result = await workflow({
      jobRunId: "job-await-timeout",
      startedAt: new Date().toISOString(),
      releasedScope: {
        sourceKind: "flow",
        sourceType: "pr_opened",
        sourceId: "flow-timeout",
        repoId: "repo-timeout",
        installationId: 88,
      },
    });

    assert.equal(result.success, false);
    assert.equal(persistFailureCalled, true);
    assert.deepEqual(finalizeWaitCalls, [
      { waitId: "wait-row-2", status: "expired" },
    ]);
    const failedAwaitRow = completedStatuses.find(
      (entry) => entry.status === "failed"
    );
    assert.ok(
      failedAwaitRow,
      "expected a failed flow_node_run for await_event"
    );
    assert.ok(failedAwaitRow!.error?.includes("timed out"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("createAutomationJobTask routes await_event timeout failures to a downstream error edge when one is wired", async () => {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();

  const originalFetch = globalThis.fetch;
  const insertedNodeTypes: string[] = [];
  // Map node-run id -> node id so PATCH status matches a specific node.
  const nodeRunIdToNodeId = new Map<string, string>();
  const completedByNodeId = new Map<string, string>();
  let nodeRunSequence = 0;
  let persistedSuccess = false;
  let persistFailureCalled = false;

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: { source_type: "pr_opened" },
        assignmentType: "pr_review",
        skillId: null,
        agent: { model: "openai/gpt-5.4", system_prompt: null },
        repo: {
          id: "repo-recover",
          user_id: "user-recover",
          full_name: "acme/widgets",
          github_installation_id: 99,
        },
      },
      flow: {
        flowId: "flow-recover",
        flowVersionId: "flow-version-recover",
        graph: {
          nodes: [
            {
              id: "start-1",
              type: "start",
              position: { x: 0, y: 0 },
              data: { label: "Start", event: "pr_opened", isDefault: false },
            },
            {
              id: "await-1",
              type: "await_event",
              position: { x: 240, y: 0 },
              data: {
                label: "Wait for ship",
                config: {
                  kind: "github_label_added",
                  labelName: "ship",
                  prOnly: true,
                },
                timeout: { value: 1, unit: "minutes" },
              },
            },
            {
              id: "recover-1",
              type: "set_variable",
              position: { x: 480, y: 200 },
              data: {
                label: "Record timeout",
                assignments: [{ key: "await_status", template: "timed_out" }],
              },
            },
            {
              id: "end-1",
              type: "end",
              position: { x: 720, y: 0 },
              data: { label: "Done" },
            },
          ],
          edges: [
            { id: "e1", source: "start-1", target: "await-1" },
            { id: "e2", source: "await-1", target: "end-1" },
            {
              id: "e3",
              source: "await-1",
              target: "recover-1",
              sourceHandle: "error",
            },
            { id: "e4", source: "recover-1", target: "end-1" },
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
    getDurationMs: async () => 50,
    persistJobSuccess: async () => {
      persistedSuccess = true;
      return true;
    },
    tryLogAiCall: async () => null,
    recordControlDispatchEvent: async () => {},
    releaseQueuedJobs: async () => [],
    isJobRunCancellationRequested: async () => false,
    throwIfJobRunCancelled: async () => {},
    persistJobFailure: async () => {
      persistFailureCalled = true;
      return true;
    },
    waitProvider: {
      sleep: async () => {},
      createToken: async () => ({ id: "tok-recover-1" }),
      waitForToken: async () => ({
        ok: false,
        reason: "timeout",
        message: "wait expired",
      }),
    },
    waitStore: {
      createWait: async () => ({ id: "wait-row-recover" }),
      finalizeWait: async () => {},
    },
  });

  globalThis.fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    const method = (init?.method ?? "GET").toUpperCase();
    if (!url.startsWith("https://example.supabase.co")) {
      throw new Error(`Unexpected fetch in test: ${method} ${url}`);
    }
    if (url.includes("/rest/v1/flow_node_runs")) {
      if (method === "POST") {
        const body =
          typeof init?.body === "string" ? JSON.parse(init.body) : {};
        nodeRunSequence += 1;
        const id = `node-run-${nodeRunSequence}`;
        if (typeof body.node_id === "string") {
          nodeRunIdToNodeId.set(id, body.node_id);
        }
        if (typeof body.node_type === "string") {
          insertedNodeTypes.push(body.node_type);
        }
        return Response.json(
          { id, started_at: new Date().toISOString() },
          { status: 201 }
        );
      }
      if (method === "PATCH") {
        const body =
          typeof init?.body === "string" ? JSON.parse(init.body) : {};
        const match = url.match(/flow_node_runs.*id=eq\.([^&]+)/);
        const nodeRunId = match ? decodeURIComponent(match[1]) : null;
        const nodeId = nodeRunId
          ? (nodeRunIdToNodeId.get(nodeRunId) ?? null)
          : null;
        if (nodeId && typeof body.status === "string") {
          completedByNodeId.set(nodeId, body.status);
        }
        return Response.json({ id: "node-run-updated" }, { status: 200 });
      }
    }
    return Response.json([], { status: 200 });
  };

  try {
    const result = await workflow({
      jobRunId: "job-await-recover",
      startedAt: new Date().toISOString(),
      releasedScope: {
        sourceKind: "flow",
        sourceType: "pr_opened",
        sourceId: "flow-recover",
        repoId: "repo-recover",
        installationId: 99,
      },
    });

    assert.equal(result.success, true);
    assert.equal(persistedSuccess, true);
    assert.equal(persistFailureCalled, false);
    // The failed await node should still record as "failed" — only the
    // outgoing token signal is rerouted.
    assert.equal(completedByNodeId.get("await-1"), "failed");
    // The recovery node executes and records success.
    assert.equal(completedByNodeId.get("recover-1"), "success");
    assert.ok(insertedNodeTypes.includes("set_variable"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
