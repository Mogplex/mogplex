import assert from "node:assert/strict";
import test from "node:test";
import { coerceGraph, validateFlowGraph } from "../../lib/flows/graph";
import {
  resolveTemplate,
  setVariableOperator,
} from "../../lib/flows/operators/state";
import type { FlowOperatorExecuteContext } from "../../lib/flows/operators/types";
import {
  buildSetVariablePolicyGraph,
  type CompletedNodeRun,
  type SetVariableNode,
} from "./helpers/flow-graph-fixtures";

test("resolveTemplate: whole-string single substitution preserves native type", () => {
  const state = {
    metadata: { pr_number: 42, labels: ["bug", "ready"] },
    state: { active: true },
  };
  assert.equal(resolveTemplate("{{ metadata.pr_number }}", state), 42);
  assert.deepEqual(resolveTemplate("{{ metadata.labels }}", state), [
    "bug",
    "ready",
  ]);
  assert.equal(resolveTemplate("{{ state.active }}", state), true);
});

test("resolveTemplate: mixed text interpolates as string", () => {
  const state = {
    metadata: { pr_number: 42, sender_login: "alice" },
  };
  assert.equal(
    resolveTemplate(
      "PR #{{ metadata.pr_number }} by {{ metadata.sender_login }}",
      state
    ),
    "PR #42 by alice"
  );
});

test("resolveTemplate: missing path becomes null in single mode and empty in interp mode", () => {
  const state = { metadata: {} };
  assert.equal(resolveTemplate("{{ metadata.missing }}", state), null);
  assert.equal(
    resolveTemplate("hello {{ metadata.missing }}!", state),
    "hello !"
  );
});

test("resolveTemplate: literal with no substitution passes through", () => {
  assert.equal(resolveTemplate("just a literal", {}), "just a literal");
});

test("validateFlowGraph rejects set_variable with no assignments", () => {
  const graph = buildSetVariablePolicyGraph({
    label: "Set",
    assignments: [],
  });
  const result = validateFlowGraph(graph);
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some((message) =>
      message.includes("must define at least one assignment")
    ),
    `expected missing-assignment error, got: ${result.errors.join(" | ")}`
  );
});

test("validateFlowGraph rejects set_variable with invalid key", () => {
  const graph = buildSetVariablePolicyGraph({
    label: "Set",
    assignments: [{ key: "1bad-key", template: "{{ metadata.pr_number }}" }],
  });
  const result = validateFlowGraph(graph);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((message) => message.includes("invalid key")));
});

test("validateFlowGraph rejects set_variable with duplicate keys", () => {
  const graph = buildSetVariablePolicyGraph({
    label: "Set",
    assignments: [
      { key: "foo", template: "a" },
      { key: "foo", template: "b" },
    ],
  });
  const result = validateFlowGraph(graph);
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some((message) =>
      message.includes('assigns "foo" more than once')
    )
  );
});

test("validateFlowGraph accepts set_variable with valid assignments", () => {
  const graph = buildSetVariablePolicyGraph({
    label: "Set",
    assignments: [
      { key: "pr_number", template: "{{ metadata.pr_number }}" },
      { key: "summary", template: "PR #{{ metadata.pr_number }}" },
    ],
  });
  const result = validateFlowGraph(graph);
  assert.equal(result.valid, true, result.errors.join(" | "));
});

test("coerceGraph drops malformed assignments and keeps valid ones", () => {
  const coerced = coerceGraph({
    nodes: [
      {
        id: "set",
        type: "set_variable",
        position: { x: 0, y: 0 },
        data: {
          label: "Set",
          assignments: [
            { key: "ok", template: "{{ metadata.foo }}" },
            { key: "", template: "ignored" },
            "not an object",
            { template: "missing key" },
          ],
        },
      },
    ],
    edges: [],
  });
  const node = coerced.nodes.find((n) => n.type === "set_variable");
  assert.ok(node?.type === "set_variable");
  assert.deepEqual(node.data.assignments, [
    { key: "ok", template: "{{ metadata.foo }}" },
  ]);
});

test("setVariable.execute writes flowState and persists assignments", async () => {
  const graph = buildSetVariablePolicyGraph({
    label: "Set",
    assignments: [
      { key: "pr_number", template: "{{ metadata.pr_number }}" },
      { key: "summary", template: "PR #{{ metadata.pr_number }}" },
    ],
  });
  const setNode = graph.nodes.find((n) => n.type === "set_variable")!;
  const completed: CompletedNodeRun[] = [];
  const flowState = new Map<string, unknown>();
  const ctx: FlowOperatorExecuteContext<SetVariableNode> = {
    node: setNode,
    label: setNode.data.label,
    graph,
    inboundTokens: [
      {
        fromNodeId: "start",
        label: "Start",
        text: "",
        skipped: false,
        payload: null,
      },
    ],
    activeInboundTokens: [
      {
        fromNodeId: "start",
        label: "Start",
        text: "",
        skipped: false,
        payload: null,
      },
    ],
    shouldSkip: false,
    outputs: new Map(),
    flowState,
    resolutionState: { metadata: { pr_number: 42 } },
    predecessorOutputs: () => [],
    emit: (label, text, options) => [
      {
        targetId: "end",
        token: {
          fromNodeId: setNode.id,
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
    completeSkipped: async (reason) => {
      completed.push({ status: "skipped", output: { reason } });
      return { ok: true, emitted: [] };
    },
    jobRunId: "job-1",
    flowId: "flow-1",
    flowVersionId: null,
    userId: "user-1",
    installationId: null,
    repoId: null,
    waitProvider: {
      sleep: async () => undefined,
      createToken: async () => ({ id: "tok" }),
      waitForToken: async () => ({
        ok: false as const,
        reason: "timeout" as const,
        message: "n/a",
      }),
    },
    waitStore: {
      createWait: async () => ({ id: "w" }),
      finalizeWait: async () => undefined,
    },
    actionRunner: async () => ({ summary: "", output: {} }),
  };

  const result = await setVariableOperator.execute!(ctx);
  assert.equal(result.ok, true);
  // Type preservation: number stays number; mixed text becomes string.
  assert.equal(flowState.get("pr_number"), 42);
  assert.equal(flowState.get("summary"), "PR #42");
  assert.equal(completed.length, 1);
  assert.equal(completed[0].status, "success");
  const output = completed[0].output as {
    assignments: Array<{ key: string; template: string; value: unknown }>;
  };
  assert.deepEqual(output.assignments, [
    {
      key: "pr_number",
      template: "{{ metadata.pr_number }}",
      value: 42,
    },
    {
      key: "summary",
      template: "PR #{{ metadata.pr_number }}",
      value: "PR #42",
    },
  ]);
  assert.equal(result.ok && result.emitted[0].token.skipped, false);
});

test("setVariable.execute skips when every inbound branch is skipped", async () => {
  const graph = buildSetVariablePolicyGraph({
    label: "Set",
    assignments: [{ key: "ok", template: "x" }],
  });
  const setNode = graph.nodes.find((n) => n.type === "set_variable")!;
  const completed: CompletedNodeRun[] = [];
  const flowState = new Map<string, unknown>();
  const ctx: FlowOperatorExecuteContext<SetVariableNode> = {
    node: setNode,
    label: setNode.data.label,
    graph,
    inboundTokens: [
      {
        fromNodeId: "start",
        label: "Start",
        text: "",
        skipped: true,
        payload: null,
      },
    ],
    activeInboundTokens: [],
    shouldSkip: true,
    outputs: new Map(),
    flowState,
    resolutionState: { metadata: {} },
    predecessorOutputs: () => [],
    emit: () => [],
    completeNodeRun: async (completion) => {
      completed.push(completion);
      return 1;
    },
    completeSkipped: async (reason) => {
      completed.push({ status: "skipped", output: { reason } });
      return { ok: true, emitted: [] };
    },
    jobRunId: "job-1",
    flowId: "flow-1",
    flowVersionId: null,
    userId: "user-1",
    installationId: null,
    repoId: null,
    waitProvider: {
      sleep: async () => undefined,
      createToken: async () => ({ id: "tok" }),
      waitForToken: async () => ({
        ok: false as const,
        reason: "timeout" as const,
        message: "n/a",
      }),
    },
    waitStore: {
      createWait: async () => ({ id: "w" }),
      finalizeWait: async () => undefined,
    },
    actionRunner: async () => ({ summary: "", output: {} }),
  };

  await setVariableOperator.execute!(ctx);
  assert.equal(flowState.size, 0);
  assert.equal(completed[0].status, "skipped");
});
