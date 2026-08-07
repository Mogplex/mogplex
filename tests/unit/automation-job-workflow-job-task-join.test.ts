import assert from "node:assert/strict";
import test from "node:test";
import {
  type CapturedControlDispatchEvent,
  loadAutomationJobWorkflowModule,
} from "./helpers/automation-job-fixtures";

test("createAutomationJobTask wait_for_any join fires after the first active branch and ignores slower branches", async () => {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();

  const originalFetch = globalThis.fetch;
  let nodeRunSequence = 0;
  // Map node-run id -> { node_id, node_type } so PATCH bodies can be matched
  // back to the specific node that emitted them.
  const nodeRunCatalog = new Map<
    string,
    { nodeId: string; nodeType: string }
  >();
  const completedByNodeId: Array<{
    nodeId: string;
    nodeType: string;
    status: string;
    output: Record<string, unknown> | null;
  }> = [];
  let persistedSuccess = false;
  let controlDispatchEvent: CapturedControlDispatchEvent | null = null;

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: { source_type: "pr_opened" },
        assignmentType: "pr_review",
        skillId: null,
        agent: { model: "openai/gpt-5.4", system_prompt: null },
        repo: {
          id: "repo-join-any",
          user_id: "user-join-any",
          full_name: "acme/widgets",
          default_branch: "main",
          github_installation_id: 91,
        },
      },
      flow: {
        flowId: "flow-join-any",
        flowVersionId: "flow-version-join-any",
        // start → parallel
        //   ├─ delay-fast → join (depth 1)
        //   └─ delay-slow1 → delay-slow2 → join (depth 2)
        // → end
        // wait_for_any policy means the join fires after delay-fast emits.
        // delay-slow2 still emits after the join is processed; that token
        // should be discarded by the executor.
        graph: {
          nodes: [
            {
              id: "start-1",
              type: "start",
              position: { x: 0, y: 0 },
              data: { label: "Start", event: "pr_opened", isDefault: false },
            },
            {
              id: "parallel-1",
              type: "parallel",
              position: { x: 200, y: 0 },
              data: { label: "Fan out" },
            },
            {
              id: "delay-fast",
              type: "delay",
              position: { x: 400, y: -80 },
              data: { label: "Fast", duration: 0, unit: "seconds" },
            },
            {
              id: "delay-slow1",
              type: "delay",
              position: { x: 400, y: 80 },
              data: { label: "Slow 1", duration: 0, unit: "seconds" },
            },
            {
              id: "delay-slow2",
              type: "delay",
              position: { x: 600, y: 80 },
              data: { label: "Slow 2", duration: 0, unit: "seconds" },
            },
            {
              id: "join-1",
              type: "join",
              position: { x: 800, y: 0 },
              data: { label: "Race", policy: "wait_for_any" },
            },
            {
              id: "end-1",
              type: "end",
              position: { x: 1000, y: 0 },
              data: { label: "Done" },
            },
          ],
          edges: [
            { id: "e1", source: "start-1", target: "parallel-1" },
            { id: "e2", source: "parallel-1", target: "delay-fast" },
            { id: "e3", source: "parallel-1", target: "delay-slow1" },
            { id: "e4", source: "delay-fast", target: "join-1" },
            { id: "e5", source: "delay-slow1", target: "delay-slow2" },
            { id: "e6", source: "delay-slow2", target: "join-1" },
            { id: "e7", source: "join-1", target: "end-1" },
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
    waitProvider: {
      sleep: async () => {},
      createToken: async () => ({ id: "tok" }),
      waitForToken: async <T>() => ({ ok: true as const, output: {} as T }),
    },
    waitStore: {
      createWait: async () => ({ id: "wait" }),
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
        nodeRunCatalog.set(id, {
          nodeId: String(body.node_id ?? ""),
          nodeType: String(body.node_type ?? ""),
        });
        return Response.json(
          { id, started_at: "2026-04-30T22:00:00.000Z" },
          { status: 201 }
        );
      }
      if (method === "PATCH") {
        const idMatch = url.match(/id=eq\.([^&]+)/);
        const id = idMatch?.[1] ?? "";
        const catalogEntry = nodeRunCatalog.get(id);
        const body =
          typeof init?.body === "string" ? JSON.parse(init.body) : {};
        if (catalogEntry && typeof body.status === "string") {
          completedByNodeId.push({
            nodeId: catalogEntry.nodeId,
            nodeType: catalogEntry.nodeType,
            status: body.status,
            output: (body.output ?? null) as Record<string, unknown> | null,
          });
        }
        return Response.json({ id: "node-run-updated" }, { status: 200 });
      }
    }
    return Response.json([], { status: 200 });
  };

  try {
    const result = await workflow({
      jobRunId: "job-join-any",
      startedAt: "2026-04-30T22:00:00.000Z",
      releasedScope: {
        sourceKind: "flow",
        sourceType: "pr_opened",
        sourceId: "flow-join-any",
        repoId: "repo-join-any",
        installationId: 91,
      },
    });

    assert.equal(result.success, true);
    assert.equal(persistedSuccess, true);
    const capturedDispatch =
      controlDispatchEvent as unknown as CapturedControlDispatchEvent | null;
    assert.equal(capturedDispatch?.outcome, "completed");

    const joinCompletion = completedByNodeId.find(
      (entry) => entry.nodeId === "join-1"
    );
    assert.ok(
      joinCompletion,
      `expected a flow_node_runs PATCH for join-1; saw ${JSON.stringify(completedByNodeId)}`
    );
    assert.equal(joinCompletion!.status, "success");
    const output = joinCompletion!.output ?? {};
    assert.equal(output.policy, "wait_for_any");
    assert.equal(output.reason, "policy_satisfied");
    // The join fired after delay-fast's token arrived; delay-slow2's token
    // hadn't arrived yet, so it shows up in pending_from.
    assert.deepEqual(output.active_from, ["Fast"]);
    assert.deepEqual(output.pending_from, ["Slow 2"]);
    assert.equal(output.emitted_after, 1);

    // The whole flow should still complete (end ran), even though delay-slow2
    // emitted to a join that was already processed — that token is dropped.
    const endCompletion = completedByNodeId.find(
      (entry) => entry.nodeId === "end-1"
    );
    assert.ok(endCompletion, "expected end-1 to be reached");
    assert.equal(endCompletion!.status, "success");

    // The join must only have completed once.
    const joinCompletions = completedByNodeId.filter(
      (entry) => entry.nodeId === "join-1"
    );
    assert.equal(joinCompletions.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
