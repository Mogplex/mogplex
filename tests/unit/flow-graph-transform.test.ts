import assert from "node:assert/strict";
import test from "node:test";
import { coerceGraph, validateFlowGraph } from "../../lib/flows/graph";
import {
  applyFlowTransform,
  transformOperator,
} from "../../lib/flows/operators/transform";
import type { FlowOperatorExecuteContext } from "../../lib/flows/operators/types";
import {
  buildTransformPolicyGraph,
  type CompletedNodeRun,
  type TransformNode,
} from "./helpers/flow-graph-fixtures";

test("applyFlowTransform supports every bounded transform operation", () => {
  assert.equal(
    applyFlowTransform(
      { key: "copy", source: "metadata.title", operation: "copy" },
      "Fix tests"
    ),
    "Fix tests"
  );
  assert.equal(
    applyFlowTransform(
      {
        key: "contains",
        source: "metadata.title",
        operation: "string_contains",
        argument: "tests",
      },
      "Fix tests"
    ),
    true
  );
  assert.deepEqual(
    applyFlowTransform(
      {
        key: "parts",
        source: "metadata.labels",
        operation: "string_split",
        argument: ",",
      },
      "bug,ready"
    ),
    ["bug", "ready"]
  );
  assert.equal(
    applyFlowTransform(
      {
        key: "joined",
        source: "metadata.labels",
        operation: "array_join",
        argument: " - ",
      },
      ["bug", "ready"]
    ),
    "bug - ready"
  );
  assert.equal(
    applyFlowTransform(
      {
        key: "count",
        source: "metadata.labels",
        operation: "array_length",
      },
      ["bug", "ready"]
    ),
    2
  );
  assert.equal(
    applyFlowTransform(
      {
        key: "ready",
        source: "metadata.labels",
        operation: "array_includes",
        argument: "ready",
      },
      ["bug", "ready"]
    ),
    true
  );
  assert.equal(
    applyFlowTransform(
      {
        key: "tests_changed",
        source: "metadata.changed_files",
        operation: "files_match_glob",
        argument: "**/*.test.ts",
      },
      ["app/page.tsx", "lib/root.test.ts", "tests/unit/nested.test.ts"]
    ),
    true
  );
  assert.equal(
    applyFlowTransform(
      {
        key: "exact_test",
        source: "metadata.changed_files",
        operation: "files_match_glob",
        argument: "**/test.ts",
      },
      ["contest.ts"]
    ),
    false
  );
  assert.equal(
    applyFlowTransform(
      {
        key: "exact_test",
        source: "metadata.changed_files",
        operation: "files_match_glob",
        argument: "**/test.ts",
      },
      ["test.ts"]
    ),
    true
  );
  assert.equal(
    applyFlowTransform(
      {
        key: "nested_b",
        source: "metadata.changed_files",
        operation: "files_match_glob",
        argument: "a/**/b",
      },
      ["a/xxb"]
    ),
    false
  );
  assert.equal(
    applyFlowTransform(
      {
        key: "nested_b",
        source: "metadata.changed_files",
        operation: "files_match_glob",
        argument: "a/**/b",
      },
      ["a/b", "a/x/b"]
    ),
    true
  );
  assert.equal(
    applyFlowTransform(
      {
        key: "embedded_globstar",
        source: "metadata.changed_files",
        operation: "files_match_glob",
        argument: "a**/b",
      },
      ["afoo/x/b"]
    ),
    false
  );
  assert.equal(
    applyFlowTransform(
      {
        key: "embedded_globstar",
        source: "metadata.changed_files",
        operation: "files_match_glob",
        argument: "a**/b",
      },
      ["afoo/b"]
    ),
    true
  );
  assert.equal(
    applyFlowTransform(
      {
        key: "enabled",
        source: "metadata.enabled",
        operation: "cast_boolean",
      },
      "yes"
    ),
    true
  );
  assert.equal(
    applyFlowTransform(
      {
        key: "retries",
        source: "metadata.retries",
        operation: "cast_number",
      },
      "3"
    ),
    3
  );
});

test("validateFlowGraph rejects malformed transform configuration", () => {
  const graph = buildTransformPolicyGraph({
    label: "Derive state",
    assignments: [
      {
        key: "1bad",
        source: "metadata.changed files",
        operation: "files_match_glob",
      },
    ],
  });
  const result = validateFlowGraph(graph);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("invalid key")));
  assert.ok(
    result.errors.some((error) => error.includes("invalid source path"))
  );
  assert.ok(
    result.errors.some((error) =>
      error.includes("requires an argument for files_match_glob")
    )
  );
});

test("coerceGraph preserves valid transform assignments and drops malformed entries", () => {
  const graph = coerceGraph({
    nodes: [
      {
        id: "transform",
        type: "transform",
        position: { x: 0, y: 0 },
        data: {
          label: "Derive state",
          assignments: [
            {
              key: "tests_changed",
              source: "metadata.changed_files",
              operation: "files_match_glob",
              argument: "**/*.test.ts",
            },
            { key: "", source: "metadata.title", operation: "copy" },
            "bad",
          ],
        },
      },
    ],
    edges: [],
  });
  const node = graph.nodes[0];
  assert.ok(node?.type === "transform");
  assert.deepEqual(node.data.assignments, [
    {
      key: "tests_changed",
      source: "metadata.changed_files",
      operation: "files_match_glob",
      argument: "**/*.test.ts",
    },
  ]);
});

test("coerceGraph preserves unsupported transform operations for validation", () => {
  const graph = coerceGraph({
    nodes: [
      {
        id: "start",
        type: "start",
        position: { x: 0, y: 0 },
        data: { label: "PR opened", event: "pr_opened" },
      },
      {
        id: "agent",
        type: "agent",
        position: { x: 150, y: 0 },
        data: {
          label: "Review",
          agentId: "agent-1",
          role: "review",
          modelOverride: "openai/gpt-5.4",
        },
      },
      {
        id: "transform",
        type: "transform",
        position: { x: 300, y: 0 },
        data: {
          label: "Derive state",
          assignments: [
            {
              key: "file_count",
              source: "metadata.changed_files",
              operation: "array_lenght",
            },
          ],
        },
      },
      {
        id: "end",
        type: "end",
        position: { x: 450, y: 0 },
        data: { label: "Done" },
      },
    ],
    edges: [
      { id: "e1", source: "start", target: "agent" },
      { id: "e2", source: "agent", target: "transform" },
      { id: "e3", source: "transform", target: "end" },
    ],
  });
  const node = graph.nodes.find((candidate) => candidate.id === "transform");
  assert.ok(node?.type === "transform");
  assert.equal(node.data.assignments[0]?.operation, "array_lenght");

  const result = validateFlowGraph(graph);
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some((error) =>
      error.includes('unsupported operation "array_lenght"')
    )
  );
});

function createTransformContext(input: {
  node: TransformNode;
  resolutionState: Record<string, unknown>;
}) {
  const completed: CompletedNodeRun[] = [];
  const flowState = new Map<string, unknown>();
  const context: FlowOperatorExecuteContext<TransformNode> = {
    node: input.node,
    label: input.node.data.label,
    graph: buildTransformPolicyGraph(input.node.data),
    inboundTokens: [
      {
        fromNodeId: "triage",
        label: "Triage",
        text: "done",
        skipped: false,
      },
    ],
    activeInboundTokens: [
      {
        fromNodeId: "triage",
        label: "Triage",
        text: "done",
        skipped: false,
      },
    ],
    shouldSkip: false,
    outputs: new Map(),
    flowState,
    resolutionState: input.resolutionState,
    predecessorOutputs: () => [],
    emit: (label, text, options) => [
      {
        targetId: "end",
        token: {
          fromNodeId: input.node.id,
          label,
          text,
          skipped: options?.skipped ?? false,
          payload: options?.payload ?? null,
        },
      },
    ],
    completeNodeRun: async (completion) => {
      completed.push(completion);
      return 1;
    },
    completeSkipped: async () => ({ ok: true, emitted: [] }),
    jobRunId: "job-1",
    flowId: "flow-1",
    flowVersionId: null,
    userId: "user-1",
    installationId: 1,
    repoId: "repo-1",
    waitProvider: {
      sleep: async () => undefined,
      createToken: async () => ({ id: "token" }),
      waitForToken: async () => ({
        ok: false as const,
        reason: "timeout" as const,
        message: "n/a",
      }),
    },
    waitStore: {
      createWait: async () => ({ id: "wait" }),
      finalizeWait: async () => undefined,
    },
    actionRunner: async () => ({ summary: "", output: {} }),
  };
  return { context, completed, flowState };
}

test("transform.execute writes typed state and persists structured output", async () => {
  const node: TransformNode = {
    id: "transform",
    type: "transform",
    position: { x: 0, y: 0 },
    data: {
      label: "Derive state",
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
          key: "retries",
          source: "metadata.retries",
          operation: "cast_number",
        },
      ],
    },
  };
  const { context, completed, flowState } = createTransformContext({
    node,
    resolutionState: {
      metadata: {
        changed_files: ["app/page.tsx", "lib/page.test.ts"],
        retries: "2",
      },
    },
  });

  const result = await transformOperator.execute!(context);
  assert.equal(result.ok, true);
  assert.equal(flowState.get("tests_changed"), true);
  assert.equal(flowState.get("file_count"), 2);
  assert.equal(flowState.get("retries"), 2);
  assert.equal(completed[0]?.status, "success");
  assert.deepEqual(
    (completed[0]?.output as { transformations: unknown[] }).transformations,
    [
      { ...node.data.assignments[0], value: true },
      { ...node.data.assignments[1], value: 2 },
      { ...node.data.assignments[2], value: 2 },
    ]
  );
  assert.deepEqual(result.ok ? result.emitted[0]?.token.payload : null, {
    state: {
      tests_changed: true,
      file_count: 2,
      retries: 2,
    },
  });
});

test("transform.execute fails atomically when a source cannot be resolved", async () => {
  const node: TransformNode = {
    id: "transform",
    type: "transform",
    position: { x: 0, y: 0 },
    data: {
      label: "Derive state",
      assignments: [
        { key: "title", source: "metadata.title", operation: "copy" },
        { key: "missing", source: "metadata.missing", operation: "copy" },
      ],
    },
  };
  const { context, completed, flowState } = createTransformContext({
    node,
    resolutionState: { metadata: { title: "PR title" } },
  });

  const result = await transformOperator.execute!(context);
  assert.equal(result.ok, false);
  assert.equal(flowState.size, 0);
  assert.equal(completed[0]?.status, "failed");
  assert.match(
    result.ok ? "" : result.message,
    /could not resolve "metadata\.missing"/
  );
});
