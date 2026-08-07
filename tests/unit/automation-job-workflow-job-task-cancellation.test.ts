import assert from "node:assert/strict";
import test from "node:test";
import { loadAutomationJobWorkflowModule } from "./helpers/automation-job-fixtures";

test("createAutomationJobTask preserves fail-fast when no error edge is wired", async () => {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();

  const originalFetch = globalThis.fetch;
  let persistedFailure = false;
  let persistedSuccess = false;

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: { source_type: "pr_opened" },
        assignmentType: "pr_review",
        skillId: null,
        agent: { model: "openai/gpt-5.4", system_prompt: null },
        repo: {
          id: "repo-failfast",
          user_id: "user-failfast",
          full_name: "acme/widgets",
          github_installation_id: 100,
        },
      },
      flow: {
        flowId: "flow-failfast",
        flowVersionId: "flow-version-failfast",
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
                timeout: { value: 1, unit: "minutes" },
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
      persistedFailure = true;
      return true;
    },
    waitProvider: {
      sleep: async () => {},
      createToken: async () => ({ id: "tok-failfast" }),
      waitForToken: async () => ({
        ok: false,
        reason: "timeout",
        message: "wait expired",
      }),
    },
    waitStore: {
      createWait: async () => ({ id: "wait-row-failfast" }),
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
        return Response.json(
          { id: "node-run", started_at: new Date().toISOString() },
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
      jobRunId: "job-failfast",
      startedAt: new Date().toISOString(),
      releasedScope: {
        sourceKind: "flow",
        sourceType: "pr_opened",
        sourceId: "flow-failfast",
        repoId: "repo-failfast",
        installationId: 100,
      },
    });

    assert.equal(result.success, false);
    assert.equal(persistedFailure, true);
    assert.equal(persistedSuccess, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("createAutomationJobTask does not route cancellation to a downstream error edge", async () => {
  const { createAutomationJobTask, JobRunCancelledError } =
    await loadAutomationJobWorkflowModule();

  const originalFetch = globalThis.fetch;
  const insertedNodeTypes: string[] = [];
  let persistedSuccess = false;
  let persistedFailure: { error: string } | null = null;
  let recoverNodeRan = false;
  let cancellationFired = false;

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: { source_type: "pr_opened" },
        assignmentType: "pr_review",
        skillId: null,
        agent: { model: "openai/gpt-5.4", system_prompt: null },
        repo: {
          id: "repo-cancel",
          user_id: "user-cancel",
          full_name: "acme/widgets",
          github_installation_id: 101,
        },
      },
      flow: {
        flowId: "flow-cancel",
        flowVersionId: "flow-version-cancel",
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
                timeout: { value: 1, unit: "minutes" },
              },
            },
            {
              id: "recover-1",
              type: "set_variable",
              position: { x: 480, y: 200 },
              data: {
                label: "Record cancel",
                assignments: [{ key: "await_status", template: "cancelled" }],
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
    persistJobFailure: async (input) => {
      persistedFailure = { error: input.error };
      return true;
    },
    waitProvider: {
      sleep: async () => {},
      createToken: async () => ({ id: "tok-cancel" }),
      // Simulate a cancellation thrown from inside the wait by throwing the
      // executor's cancellation error — the catch block should NOT route this
      // to the recovery edge.
      waitForToken: async () => {
        cancellationFired = true;
        throw new JobRunCancelledError();
      },
    },
    waitStore: {
      createWait: async () => ({ id: "wait-row-cancel" }),
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
        if (typeof body.node_type === "string") {
          insertedNodeTypes.push(body.node_type);
          if (body.node_id === "recover-1") recoverNodeRan = true;
        }
        return Response.json(
          {
            id: `node-run-${insertedNodeTypes.length}`,
            started_at: new Date().toISOString(),
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
      jobRunId: "job-cancel",
      startedAt: new Date().toISOString(),
      releasedScope: {
        sourceKind: "flow",
        sourceType: "pr_opened",
        sourceId: "flow-cancel",
        repoId: "repo-cancel",
        installationId: 101,
      },
    });

    assert.equal(cancellationFired, true);
    assert.equal(result.success, false);
    assert.equal(
      "error" in result ? result.error : null,
      "JOB_RUN_CANCELLED",
      "cancellation must surface as JOB_RUN_CANCELLED, not be caught by error edge"
    );
    assert.equal(persistedSuccess, false);
    assert.equal(recoverNodeRan, false);
    // Cancellation does not flow through persistJobFailure — the wrapper
    // releases queued jobs and returns directly.
    assert.equal(persistedFailure, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
