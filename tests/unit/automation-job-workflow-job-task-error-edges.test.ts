import assert from "node:assert/strict";
import test from "node:test";
import { loadAutomationJobWorkflowModule } from "./helpers/automation-job-fixtures";

test("createAutomationJobTask routes action failures through the error edge", async () => {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();

  const originalFetch = globalThis.fetch;
  const insertedNodeTypes: string[] = [];
  const completedStatuses: string[] = [];
  let nodeRunSequence = 0;
  let persistedSuccess = false;

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: { source_type: "issue_opened" },
        assignmentType: "issue_triage",
        skillId: null,
        agent: { model: "openai/gpt-5.4", system_prompt: null },
        repo: {
          id: "repo-action-failure",
          user_id: "user-action-failure",
          full_name: "acme/widgets",
          default_branch: "main",
          github_installation_id: 77,
        },
      },
      flow: {
        flowId: "flow-action-failure",
        flowVersionId: "flow-version-action-failure",
        graph: {
          nodes: [
            {
              id: "start-1",
              type: "start",
              position: { x: 0, y: 0 },
              data: { label: "Start", event: "issue_opened" },
            },
            {
              id: "action-1",
              type: "action",
              position: { x: 240, y: 0 },
              data: {
                label: "Notify",
                operation: "slack.send_message",
                teamId: "T123",
                channelId: "C123",
                channelName: "alerts",
                message: "Build failed",
              },
            },
            {
              id: "recover-1",
              type: "set_variable",
              position: { x: 480, y: 180 },
              data: {
                label: "Record failure",
                assignments: [
                  { key: "notification_status", template: "failed" },
                ],
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
        },
        agentsById: new Map(),
      },
    }),
    resolveGithubToken: async () => "github-token",
    runFlowAction: async () => {
      throw new Error("Slack workspace unavailable");
    },
    getDurationMs: async () => 10,
    persistJobSuccess: async () => {
      persistedSuccess = true;
      return true;
    },
    persistJobFailure: async () => {
      throw new Error("persistJobFailure should not be called");
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
        insertedNodeTypes.push(String(body.node_type));
        nodeRunSequence += 1;
        return Response.json(
          {
            id: `node-run-${nodeRunSequence}`,
            started_at: "2026-07-23T16:00:00.000Z",
          },
          { status: 201 }
        );
      }
      if (method === "PATCH") {
        completedStatuses.push(String(body.status));
        return Response.json({ id: "updated" }, { status: 200 });
      }
    }
    return Response.json([], { status: 200 });
  };

  try {
    const result = await workflow({
      jobRunId: "job-action-failure",
      startedAt: "2026-07-23T16:00:00.000Z",
      releasedScope: {
        sourceKind: "flow",
        sourceType: "issue_opened",
        sourceId: "flow-action-failure",
        repoId: "repo-action-failure",
        installationId: 77,
      },
    });

    assert.equal(result.success, true);
    assert.equal(persistedSuccess, true);
    assert.deepEqual(insertedNodeTypes, [
      "start",
      "action",
      "set_variable",
      "end",
    ]);
    assert.ok(completedStatuses.includes("failed"));
    assert.ok(completedStatuses.includes("success"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("createAutomationJobTask resumes an await_event node when the wait token completes", async () => {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();

  const originalFetch = globalThis.fetch;
  const insertedNodeTypes: string[] = [];
  const completedStatuses: string[] = [];
  const createWaitCalls: Array<Record<string, unknown>> = [];
  const finalizeWaitCalls: Array<{ waitId: string; status: string }> = [];

  let nodeRunSequence = 0;
  let createTokenCount = 0;
  let waitForTokenCount = 0;
  let persistedSuccess = false;

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: { source_type: "pr_opened" },
        assignmentType: "pr_review",
        skillId: null,
        agent: { model: "openai/gpt-5.4", system_prompt: null },
        repo: {
          id: "repo-await",
          user_id: "user-await",
          full_name: "acme/widgets",
          default_branch: "main",
          github_installation_id: 77,
        },
      },
      flow: {
        flowId: "flow-await",
        flowVersionId: "flow-version-await",
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
                label: "Wait for ready",
                config: {
                  kind: "github_label_added",
                  labelName: "ready",
                  prOnly: true,
                },
                timeout: { value: 1, unit: "hours" },
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
      persistedSuccess = true;
      return true;
    },
    tryLogAiCall: async () => null,
    recordControlDispatchEvent: async () => {},
    releaseQueuedJobs: async () => [],
    isJobRunCancellationRequested: async () => false,
    throwIfJobRunCancelled: async () => {},
    persistJobFailure: async () => {
      throw new Error("persistJobFailure should not be called");
    },
    waitProvider: {
      sleep: async () => {},
      createToken: async () => {
        createTokenCount += 1;
        return { id: "tok-await-1" };
      },
      waitForToken: async <T>() => {
        waitForTokenCount += 1;
        return {
          ok: true as const,
          output: { delivery_id: "d-1", action: "labeled" } as T,
        };
      },
    },
    waitStore: {
      createWait: async (input) => {
        createWaitCalls.push(input as unknown as Record<string, unknown>);
        return { id: "wait-row-1" };
      },
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
        const body =
          typeof init?.body === "string" ? JSON.parse(init.body) : {};
        if (typeof body.node_type === "string") {
          insertedNodeTypes.push(body.node_type);
        }
        nodeRunSequence += 1;
        return Response.json(
          {
            id: `node-run-${nodeRunSequence}`,
            started_at: new Date().toISOString(),
          },
          { status: 201 }
        );
      }
      if (method === "PATCH") {
        const body =
          typeof init?.body === "string" ? JSON.parse(init.body) : {};
        if (typeof body.status === "string") {
          completedStatuses.push(body.status);
        }
        return Response.json({ id: "node-run-updated" }, { status: 200 });
      }
    }
    return Response.json([], { status: 200 });
  };

  try {
    const result = await workflow({
      jobRunId: "job-await-1",
      startedAt: new Date().toISOString(),
      releasedScope: {
        sourceKind: "flow",
        sourceType: "pr_opened",
        sourceId: "flow-await",
        repoId: "repo-await",
        installationId: 77,
      },
    });

    assert.equal(result.success, true);
    assert.equal(persistedSuccess, true);
    assert.equal(createTokenCount, 1);
    assert.equal(waitForTokenCount, 1);
    assert.equal(createWaitCalls.length, 1);
    assert.equal(createWaitCalls[0]?.resumeToken, "tok-await-1");
    assert.equal(createWaitCalls[0]?.nodeId, "await-1");
    assert.deepEqual(finalizeWaitCalls, [
      { waitId: "wait-row-1", status: "resumed" },
    ]);
    assert.ok(insertedNodeTypes.includes("await_event"));
    // The await_event row completes as success once the token is resumed.
    assert.ok(completedStatuses.includes("success"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
