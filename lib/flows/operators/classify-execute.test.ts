import { describe, expect, it } from "vitest";
import type {
  FlowClassifyNodeData,
  FlowClassifyResult,
  FlowEdge,
  FlowGraph,
  FlowNode,
} from "@/lib/types";
import { classifyOperator } from "./classify";
import type {
  FlowOperatorClassifier,
  FlowOperatorExecuteContext,
} from "./types";

type ClassifyNode = Extract<FlowNode, { type: "classify" }>;
type ClassifierInput = Parameters<FlowOperatorClassifier>[0];

const triageOptions = [
  { id: "bug", label: "Bug report" },
  { id: "feature", label: "Feature request" },
];

function makeNode(data: Partial<FlowClassifyNodeData> = {}): ClassifyNode {
  return {
    id: "classify-1",
    type: "classify",
    position: { x: 0, y: 0 },
    data: {
      label: "Triage",
      input: "{{metadata.title}}",
      question: "Is this a bug report?",
      output: { kind: "boolean" },
      resultKey: "triage",
      minConfidence: null,
      ...data,
    },
  };
}

function edge(sourceHandle: string | null, target = "end"): FlowEdge {
  return {
    id: `edge-${sourceHandle ?? "default"}-${target}`,
    source: "classify-1",
    target,
    sourceHandle,
  };
}

const booleanEdges = [edge("true", "a"), edge("false", "b")];

function execute(
  node: ClassifyNode,
  edges: FlowEdge[],
  options: {
    result?: FlowClassifyResult;
    failure?: string;
    resolutionState?: Record<string, unknown>;
    shouldSkip?: boolean;
  }
) {
  const graph: FlowGraph = { nodes: [node], edges };
  const asked: ClassifierInput[] = [];
  const completed: Array<Record<string, unknown>> = [];
  const outputs = new Map<string, { label: string; text: string }>();
  const flowState = new Map<string, unknown>();
  const ctx = {
    node,
    label: node.data.label,
    graph,
    inboundTokens: [],
    activeInboundTokens: [],
    shouldSkip: options.shouldSkip ?? false,
    outputs,
    flowState,
    resolutionState: options.resolutionState ?? {
      metadata: { title: "Login crashes on submit" },
    },
    predecessorOutputs: () => [],
    emit: (label, text, emitOptions) =>
      edges
        .filter((item) => emitOptions?.selector?.(item) ?? true)
        .map((item) => ({
          targetId: item.target,
          token: {
            fromNodeId: node.id,
            label,
            text,
            skipped: emitOptions?.skipped ?? false,
            payload: emitOptions?.payload ?? null,
          },
        })),
    completeNodeRun: async (completion) => {
      completed.push(completion);
      return 0;
    },
    completeSkipped: async (reason) => {
      completed.push({ status: "skipped", reason });
      return { ok: true, emitted: [] };
    },
    jobRunId: "job-1",
    flowId: "flow-1",
    flowVersionId: null,
    userId: "user-1",
    installationId: null,
    repoId: null,
    waitProvider: {} as FlowOperatorExecuteContext["waitProvider"],
    waitStore: {} as FlowOperatorExecuteContext["waitStore"],
    actionRunner: async () => ({ summary: "", output: {} }),
    classifier: async (input) => {
      asked.push(input);
      return options.failure
        ? { ok: false, message: options.failure }
        : { ok: true, result: options.result! };
    },
  } satisfies FlowOperatorExecuteContext<ClassifyNode>;
  return {
    run: classifyOperator.execute!(ctx),
    asked,
    completed,
    outputs,
    flowState,
  };
}

function routed(
  result: Awaited<ReturnType<NonNullable<typeof classifyOperator.execute>>>
) {
  if (!result.ok) throw new Error(result.message);
  return Object.fromEntries(
    result.emitted.map((item) => [item.targetId, !item.token.skipped])
  );
}

describe("classifyOperator.execute", () => {
  const yes: FlowClassifyResult = {
    kind: "boolean",
    answer: true,
    confidence: 0.93,
    probabilities: { true: 0.93, false: 0.07 },
    uncertain: false,
  };

  it("should judge the resolved state and take only the answered branch", async () => {
    const edges = [
      edge("true", "yes"),
      edge("false", "no"),
      edge("error", "err"),
    ];
    const { run, asked, completed, outputs, flowState } = execute(
      makeNode(),
      edges,
      { result: yes }
    );

    const result = await run;

    expect(asked).toEqual([
      {
        jobRunId: "job-1",
        nodeId: "classify-1",
        nodeLabel: "Triage",
        question: "Is this a bug report?",
        output: { kind: "boolean" },
        state: "Login crashes on submit",
        minConfidence: null,
      },
    ]);
    expect(routed(result)).toEqual({ yes: true, no: false, err: false });
    if (result.ok) {
      expect(result.emitted.map((item) => item.token.text)).toEqual([
        "Triage: true at 93% confidence",
        "Triage did not take this branch",
        "Triage did not take this branch",
      ]);
    }
    expect(flowState.get("triage")).toEqual(yes);
    expect(outputs.get("classify-1")).toEqual({
      label: "Triage",
      text: "Triage: true at 93% confidence",
    });
    expect(completed).toEqual([
      {
        status: "success",
        output: { question: "Is this a bug report?", ...yes, branch: "true" },
      },
    ]);
    if (result.ok) {
      expect(result.emitted[0]?.token.payload).toEqual({ classification: yes });
    }
  });

  it("should take the false branch for a no", async () => {
    const { run } = execute(
      makeNode(),
      [edge("true", "yes"), edge("false", "no")],
      {
        result: { ...yes, answer: false },
      }
    );
    expect(routed(await run)).toEqual({ yes: false, no: true });
  });

  it("should take the chosen option's branch", async () => {
    const node = makeNode({
      output: { kind: "choice", options: triageOptions },
    });
    const { run, outputs } = execute(
      node,
      [edge("option:bug", "bug"), edge("option:feature", "feature")],
      {
        result: {
          kind: "choice",
          answer: "Feature request",
          optionId: "feature",
          confidence: 0.81,
          probabilities: {},
          uncertain: false,
        },
      }
    );
    expect(routed(await run)).toEqual({ bug: false, feature: true });
    expect(outputs.get("classify-1")?.text).toBe(
      "Triage: Feature request at 81% confidence"
    );
  });

  it("should send a scale answer down the ordinary edge with its level named", async () => {
    const node = makeNode({
      output: { kind: "scale", levels: ["low", "high"] },
    });
    const { run, outputs, completed } = execute(
      node,
      [edge(null, "next"), edge("error", "err")],
      {
        result: {
          kind: "scale",
          answer: 2,
          level: "high",
          confidence: 0.7,
          probabilities: {},
          uncertain: false,
        },
      }
    );
    expect(routed(await run)).toEqual({ next: true, err: false });
    expect(outputs.get("classify-1")?.text).toBe(
      "Triage: 2 (high) at 70% confidence"
    );
    expect(completed[0]).toMatchObject({ output: { branch: null } });
  });

  it("should send a low-confidence answer down the uncertain branch only", async () => {
    const { run, asked, outputs } = execute(
      makeNode({ minConfidence: 0.8 }),
      [edge("true", "yes"), edge("false", "no"), edge("uncertain", "review")],
      { result: { ...yes, confidence: 0.6, uncertain: true } }
    );
    expect(routed(await run)).toEqual({ yes: false, no: false, review: true });
    expect(asked[0]?.minConfidence).toBe(0.8);
    expect(outputs.get("classify-1")?.text).toBe(
      "Triage: uncertain: leaned true at 60% confidence"
    );
  });

  it("should pass structured state through without flattening it", async () => {
    const previous = [{ label: "Review", output: "2 findings" }];
    const { run, asked } = execute(
      makeNode({ input: "{{previous_outputs}}" }),
      booleanEdges,
      { result: yes, resolutionState: { previous_outputs: previous } }
    );
    await run;
    expect(asked[0]?.state).toEqual(previous);
  });

  it("should judge a number as text", async () => {
    const { run, asked } = execute(
      makeNode({ input: "{{metadata.pr_number}}" }),
      booleanEdges,
      { result: yes, resolutionState: { metadata: { pr_number: 42 } } }
    );
    await run;
    expect(asked[0]?.state).toBe("42");
  });

  it.each([
    ["a missing path", "{{metadata.missing}}", {}],
    ["blank text", "{{metadata.title}}", { metadata: { title: "  " } }],
    ["an empty list", "{{previous_outputs}}", { previous_outputs: [] }],
  ])(
    "should fail without judging when the state resolves to %s",
    async (_name, input, resolutionState) => {
      const { run, asked, flowState, completed } = execute(
        makeNode({ input }),
        booleanEdges,
        {
          result: yes,
          resolutionState,
        }
      );
      expect(await run).toEqual({
        ok: false,
        message:
          'Classify "Triage" has nothing to judge: its state resolved to empty.',
      });
      expect(asked).toHaveLength(0);
      expect(flowState.size).toBe(0);
      expect(completed).toEqual([
        {
          status: "failed",
          error:
            'Classify "Triage" has nothing to judge: its state resolved to empty.',
        },
      ]);
    }
  );

  it("should surface a classification failure for the error branch to route", async () => {
    const { run, flowState, completed } = execute(makeNode(), booleanEdges, {
      failure: "Classification timed out.",
    });
    expect(await run).toEqual({
      ok: false,
      message: "Classification timed out.",
    });
    expect(flowState.size).toBe(0);
    expect(completed).toEqual([
      { status: "failed", error: "Classification timed out." },
    ]);
  });

  it("should skip without judging when every incoming branch was skipped", async () => {
    const { run, asked, completed } = execute(makeNode(), booleanEdges, {
      result: yes,
      shouldSkip: true,
    });
    expect(await run).toEqual({ ok: true, emitted: [] });
    expect(asked).toHaveLength(0);
    expect(completed[0]).toEqual({
      status: "skipped",
      reason: "Classify skipped because every incoming branch was skipped",
    });
  });
});
