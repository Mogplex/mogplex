import assert from "node:assert/strict";
import test from "node:test";
import { loadAutomationJobWorkflowModule } from "./helpers/automation-job-fixtures";

test("createAutomationJobTask state operators feed transformed values into downstream If nodes", async () => {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();

  const originalFetch = globalThis.fetch;
  let nodeRunSequence = 0;
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
  let capturedFailureMessage: string | null = null;

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: {
          source_type: "pr_opened",
          pr_number: 7,
          changed_files: ["app/page.tsx", "lib/page.test.ts"],
        },
        assignmentType: "pr_review",
        skillId: null,
        agent: { model: "openai/gpt-5.4", system_prompt: null },
        repo: {
          id: "repo-state",
          user_id: "user-state",
          full_name: "acme/widgets",
          default_branch: "main",
          github_installation_id: 91,
        },
      },
      flow: {
        flowId: "flow-state",
        flowVersionId: "flow-version-state",
        // start → set_variable → transform → If → (then|else) → end
        // No agents: this test exercises the deterministic state path.
        graph: {
          nodes: [
            {
              id: "start-1",
              type: "start",
              position: { x: 0, y: 0 },
              data: { label: "Start", event: "pr_opened", isDefault: false },
            },
            {
              id: "set-1",
              type: "set_variable",
              position: { x: 200, y: 0 },
              data: {
                label: "Capture",
                assignments: [
                  {
                    key: "pr_number",
                    template: "{{ metadata.pr_number }}",
                  },
                  {
                    key: "summary",
                    template: "PR #{{ metadata.pr_number }}",
                  },
                ],
              },
            },
            {
              id: "transform-1",
              type: "transform",
              position: { x: 400, y: 0 },
              data: {
                label: "Derive",
                assignments: [
                  {
                    key: "tests_changed",
                    source: "metadata.changed_files",
                    operation: "files_match_glob",
                    argument: "**/*.test.ts",
                  },
                  {
                    key: "file_count",
                    source: "metadata.changed_files",
                    operation: "array_length",
                  },
                  {
                    key: "copied_pr_number",
                    source: "state.pr_number",
                    operation: "copy",
                  },
                ],
              },
            },
            {
              id: "if-1",
              type: "condition",
              position: { x: 600, y: 0 },
              data: {
                label: "Tests changed",
                mode: "all",
                rules: [
                  {
                    field: "state.tests_changed",
                    operator: "equals",
                    value: "true",
                  },
                ],
              },
            },
            {
              id: "end-then",
              type: "end",
              position: { x: 800, y: -80 },
              data: { label: "Done (then)" },
            },
            {
              id: "end-else",
              type: "end",
              position: { x: 800, y: 80 },
              data: { label: "Done (else)" },
            },
          ],
          edges: [
            { id: "e1", source: "start-1", target: "set-1" },
            { id: "e2", source: "set-1", target: "transform-1" },
            { id: "e3", source: "transform-1", target: "if-1" },
            {
              id: "e4",
              source: "if-1",
              target: "end-then",
              sourceHandle: "true",
            },
            {
              id: "e5",
              source: "if-1",
              target: "end-else",
              sourceHandle: "false",
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
    persistJobFailure: async (input) => {
      capturedFailureMessage =
        (input as { error?: string })?.error ?? "(no error)";
      return true;
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
    if (url.startsWith("https://api.github.com")) {
      // The end-of-run summary tries to post a GitHub timeline comment because
      // the metadata exposes a pr_number. Stub a successful comment create so
      // the run focuses on flow_node_runs assertions.
      if (method === "POST") {
        return Response.json(
          {
            id: 12345,
            html_url:
              "https://github.com/acme/widgets/issues/7#issuecomment-12345",
          },
          { status: 201 }
        );
      }
      return Response.json([], { status: 200 });
    }
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
          { id, started_at: "2026-05-01T12:00:00.000Z" },
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
      jobRunId: "job-state",
      startedAt: "2026-05-01T12:00:00.000Z",
      releasedScope: {
        sourceKind: "flow",
        sourceType: "pr_opened",
        sourceId: "flow-state",
        repoId: "repo-state",
        installationId: 91,
      },
    });

    assert.equal(
      result.success,
      true,
      `expected success; got failure: ${capturedFailureMessage ?? "<none>"}`
    );
    assert.equal(persistedSuccess, true);

    // set_variable persisted both assignments with type-correct values.
    const setCompletion = completedByNodeId.find(
      (entry) => entry.nodeId === "set-1"
    );
    assert.ok(setCompletion, "expected set-1 to complete");
    assert.equal(setCompletion!.nodeType, "set_variable");
    assert.equal(setCompletion!.status, "success");
    const setOutput = setCompletion!.output ?? {};
    const assignments = setOutput.assignments as Array<{
      key: string;
      template: string;
      value: unknown;
    }>;
    assert.deepEqual(assignments, [
      {
        key: "pr_number",
        template: "{{ metadata.pr_number }}",
        // Whole-string substitution preserves the source number type.
        value: 7,
      },
      {
        key: "summary",
        template: "PR #{{ metadata.pr_number }}",
        value: "PR #7",
      },
    ]);

    const transformCompletion = completedByNodeId.find(
      (entry) => entry.nodeId === "transform-1"
    );
    assert.ok(transformCompletion, "expected transform-1 to complete");
    assert.equal(transformCompletion!.nodeType, "transform");
    assert.equal(transformCompletion!.status, "success");
    assert.deepEqual(transformCompletion!.output?.transformations, [
      {
        key: "tests_changed",
        source: "metadata.changed_files",
        operation: "files_match_glob",
        argument: "**/*.test.ts",
        value: true,
      },
      {
        key: "file_count",
        source: "metadata.changed_files",
        operation: "array_length",
        value: 2,
      },
      {
        key: "copied_pr_number",
        source: "state.pr_number",
        operation: "copy",
        value: 7,
      },
    ]);

    // The If node read the Transform result and chose the then branch.
    const ifCompletion = completedByNodeId.find(
      (entry) => entry.nodeId === "if-1"
    );
    assert.ok(ifCompletion, "expected if-1 to complete");
    assert.equal(ifCompletion!.status, "success");
    assert.equal(ifCompletion?.output?.branch, "then");

    // The then branch's end ran; the else branch's end was skipped.
    const thenEnd = completedByNodeId.find(
      (entry) => entry.nodeId === "end-then"
    );
    const elseEnd = completedByNodeId.find(
      (entry) => entry.nodeId === "end-else"
    );
    assert.ok(thenEnd, "expected end-then to complete");
    assert.equal(thenEnd!.status, "success");
    assert.ok(elseEnd, "expected end-else to be observed");
    assert.equal(elseEnd!.status, "skipped");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
