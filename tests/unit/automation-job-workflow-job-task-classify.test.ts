import assert from "node:assert/strict";
import test from "node:test";
import type { FlowNodeClassifier } from "../../lib/workflows/automation-job-classify";
import { loadAutomationJobWorkflowModule } from "./helpers/automation-job-fixtures";

type NodeRunRecord = { nodeId: string; status?: string; output?: unknown };

function recordPath(id: string, y: number) {
  return {
    id,
    type: "set_variable" as const,
    position: { x: 480, y },
    data: {
      label: id,
      assignments: [
        { key: "path", template: id },
        { key: "kind", template: "{{state.kind.answer}}" },
      ],
    },
  };
}

// start -> classify -> one record node per branch (bug, feature, error) -> end
async function runTriageFlow(classifier: FlowNodeClassifier) {
  const { createAutomationJobTask } = await loadAutomationJobWorkflowModule();
  const originalFetch = globalThis.fetch;
  const nodeRuns = new Map<string, NodeRunRecord>();
  const classifierCalls: Array<Parameters<FlowNodeClassifier>[0]> = [];
  let failureMessage: string | null = null;

  const workflow = createAutomationJobTask({
    resolveJobContext: async () => ({
      context: {
        metadata: { source_type: "issue_opened", title: "Login crashes" },
        assignmentType: "issue_triage",
        skillId: null,
        agent: { model: "openai/gpt-5.4", system_prompt: null },
        repo: {
          id: "repo-classify",
          user_id: "user-classify",
          full_name: "acme/widgets",
          default_branch: "main",
          github_installation_id: 77,
        },
      },
      flow: {
        flowId: "flow-classify",
        flowVersionId: "flow-version-classify",
        graph: {
          nodes: [
            {
              id: "start-1",
              type: "start",
              position: { x: 0, y: 0 },
              data: { label: "Start", event: "issue_opened" },
            },
            {
              id: "classify-1",
              type: "classify",
              position: { x: 240, y: 0 },
              data: {
                label: "Triage",
                input: "{{metadata.title}}",
                question: "Which kind of issue is this?",
                output: {
                  kind: "choice",
                  options: [
                    { id: "bug", label: "Bug report" },
                    { id: "feature", label: "Feature request" },
                  ],
                },
                resultKey: "kind",
                minConfidence: null,
              },
            },
            recordPath("bug-path", 0),
            recordPath("feature-path", 120),
            recordPath("error-path", 240),
            {
              id: "end-1",
              type: "end",
              position: { x: 720, y: 0 },
              data: { label: "Done" },
            },
          ],
          edges: [
            { id: "e1", source: "start-1", target: "classify-1" },
            {
              id: "e2",
              source: "classify-1",
              target: "bug-path",
              sourceHandle: "option:bug",
            },
            {
              id: "e3",
              source: "classify-1",
              target: "feature-path",
              sourceHandle: "option:feature",
            },
            {
              id: "e4",
              source: "classify-1",
              target: "error-path",
              sourceHandle: "error",
            },
            { id: "e5", source: "bug-path", target: "end-1" },
            { id: "e6", source: "feature-path", target: "end-1" },
            { id: "e7", source: "error-path", target: "end-1" },
          ],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        agentsById: new Map(),
      },
    }),
    resolveGithubToken: async () => "github-token",
    classifier: async (input) => {
      classifierCalls.push(input);
      return classifier(input);
    },
    getDurationMs: async () => 10,
    persistJobSuccess: async () => true,
    persistJobFailure: async (input: { error?: string }) => {
      failureMessage = input.error ?? "failed";
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
        const id = `run-${body.node_id}`;
        nodeRuns.set(id, { nodeId: String(body.node_id) });
        return Response.json(
          { id, started_at: "2026-09-19T16:00:00.000Z" },
          { status: 201 }
        );
      }
      if (method === "PATCH") {
        const id = /id=eq\.([^&]+)/.exec(requestUrl)?.[1] ?? "";
        const existing = nodeRuns.get(decodeURIComponent(id));
        if (existing) {
          existing.status = String(body.status);
          existing.output = body.output;
        }
        return Response.json({ id }, { status: 200 });
      }
    }
    return Response.json([], { status: 200 });
  };

  try {
    const result = await workflow({
      jobRunId: "job-classify",
      startedAt: "2026-09-19T16:00:00.000Z",
      releasedScope: {
        sourceKind: "flow",
        sourceType: "issue_opened",
        sourceId: "flow-classify",
        repoId: "repo-classify",
        installationId: 77,
      },
    });
    const statusOf = (nodeId: string) => nodeRuns.get(`run-${nodeId}`)?.status;
    const outputOf = (nodeId: string) =>
      nodeRuns.get(`run-${nodeId}`)?.output as Record<string, unknown>;
    return { result, statusOf, outputOf, classifierCalls, failureMessage };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("a classify node routes the run down the answered branch and exposes its answer", async () => {
  const classification = {
    kind: "choice" as const,
    answer: "Feature request",
    optionId: "feature",
    confidence: 0.91,
    probabilities: { "Bug report": 0.09, "Feature request": 0.91 },
    uncertain: false,
  };
  const { result, statusOf, outputOf, classifierCalls } = await runTriageFlow(
    async () => ({ ok: true, result: classification })
  );

  assert.equal(result.success, true);
  assert.equal(classifierCalls.length, 1);
  assert.equal(classifierCalls[0]?.state, "Login crashes");
  assert.equal(classifierCalls[0]?.question, "Which kind of issue is this?");
  assert.equal(classifierCalls[0]?.flowId, "flow-classify");
  assert.equal(classifierCalls[0]?.context.repo.user_id, "user-classify");

  assert.equal(statusOf("classify-1"), "success");
  assert.equal(outputOf("classify-1").answer, "Feature request");
  assert.equal(outputOf("classify-1").branch, "option:feature");

  assert.equal(statusOf("feature-path"), "success");
  assert.equal(statusOf("bug-path"), "skipped");
  assert.equal(statusOf("error-path"), "skipped");
  assert.equal(statusOf("end-1"), "success");

  const assignments = outputOf("feature-path").assignments as Array<{
    key: string;
    value: unknown;
  }>;
  assert.deepEqual(
    assignments.map(({ key, value }) => [key, value]),
    [
      ["path", "feature-path"],
      ["kind", "Feature request"],
    ]
  );
});

test("a classification failure takes the error branch instead of guessing", async () => {
  const { result, statusOf } = await runTriageFlow(async () => ({
    ok: false,
    message: "Classification timed out.",
  }));

  assert.equal(result.success, true);
  assert.equal(statusOf("classify-1"), "failed");
  assert.equal(statusOf("error-path"), "success");
  assert.equal(statusOf("bug-path"), "skipped");
  assert.equal(statusOf("feature-path"), "skipped");
});
