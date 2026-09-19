import { describe, expect, it } from "vitest";
import type { FlowClassifyNodeData, FlowEdge, FlowNode } from "@/lib/types";
import {
  classifyAnswerHandles,
  classifyOperator,
  classifyResultHandle,
} from "./classify";
import type {
  FlowOperatorClassifier,
  FlowOperatorValidateContext,
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

const startNode = {
  id: "start",
  type: "start",
  position: { x: 0, y: 0 },
  data: { label: "Issue opened", event: "issue_opened" },
} as Extract<FlowNode, { type: "start" }>;

function validate(node: ClassifyNode, outbound: FlowEdge[], inboundCount = 1) {
  const inbound = Array.from({ length: inboundCount }, (_, index) => ({
    id: `in-${index}`,
    source: "start",
    target: node.id,
  }));
  const ctx: FlowOperatorValidateContext<ClassifyNode> = {
    node,
    graph: { nodes: [startNode, node], edges: [...inbound, ...outbound] },
    inbound,
    outbound,
    startNode,
    options: { requireRunnableConfig: true },
  };
  return classifyOperator.validate!(ctx);
}

const booleanEdges = [edge("true", "a"), edge("false", "b")];

describe("classifyOperator.validate", () => {
  it("should accept a wired boolean node, with or without an error branch", () => {
    expect(validate(makeNode(), booleanEdges)).toEqual([]);
    expect(validate(makeNode(), [...booleanEdges, edge("error", "c")])).toEqual(
      []
    );
  });

  it("should require an incoming edge, a question, a state, and a valid variable", () => {
    const errors = validate(
      makeNode({ question: "  ", input: "   ", resultKey: "1st" }),
      booleanEdges,
      0
    );
    expect(errors).toEqual([
      'Classify "Triage" must have at least one incoming edge.',
      'Classify "Triage" must ask a question.',
      'Classify "Triage" must define the state to judge.',
      expect.stringContaining('invalid result variable "1st"'),
    ]);
  });

  it("should require both boolean branches", () => {
    expect(validate(makeNode(), [edge("true", "a")])).toEqual([
      'Classify "Triage" must wire both the true and false branches.',
    ]);
  });

  it("should require a branch for every choice option", () => {
    const node = makeNode({
      output: { kind: "choice", options: triageOptions },
    });
    expect(validate(node, [edge("option:bug", "a")])).toEqual([
      'Classify "Triage" must wire a branch for every option.',
    ]);
    expect(
      validate(node, [edge("option:bug", "a"), edge("option:feature", "b")])
    ).toEqual([]);
  });

  it("should reject an edge from a branch the node no longer has", () => {
    const node = makeNode({
      output: { kind: "choice", options: triageOptions },
    });
    expect(
      validate(node, [
        edge("option:bug", "a"),
        edge("option:feature", "b"),
        edge("option:question", "c"),
      ])
    ).toEqual([
      'Classify "Triage" has an edge from a branch that no longer exists.',
    ]);
    expect(validate(makeNode(), [...booleanEdges, edge(null, "c")])).toEqual([
      'Classify "Triage" has an edge from a branch that no longer exists.',
    ]);
  });

  it("should bound choice options and reject blank or duplicate ones", () => {
    const one = makeNode({
      output: { kind: "choice", options: [triageOptions[0]] },
    });
    expect(validate(one, [edge("option:bug", "a")])).toEqual([
      'Classify "Triage" must define between 2 and 255 options.',
    ]);

    const many = Array.from({ length: 256 }, (_, index) => ({
      id: `o${index}`,
      label: `Option ${index}`,
    }));
    expect(
      validate(
        makeNode({ output: { kind: "choice", options: many } }),
        many.map((option) => edge(`option:${option.id}`, option.id))
      )
    ).toEqual(['Classify "Triage" must define between 2 and 255 options.']);

    const messy = makeNode({
      output: {
        kind: "choice",
        options: [
          { id: "a", label: "Same" },
          { id: "a", label: " same " },
          { id: "bad id", label: " " },
        ],
      },
    });
    expect(
      validate(messy, [edge("option:a", "x"), edge("option:bad id", "y")])
    ).toEqual([
      'Classify "Triage" must give every option a label.',
      'Classify "Triage" option ids may only contain letters, digits, underscores, and dashes.',
      'Classify "Triage" has two options with the same label.',
      'Classify "Triage" has two options with the same id.',
    ]);
  });

  it("should accept exactly two and exactly 255 options", () => {
    const max = Array.from({ length: 255 }, (_, index) => ({
      id: `o${index}`,
      label: `Option ${index}`,
    }));
    expect(
      validate(
        makeNode({ output: { kind: "choice", options: max } }),
        max.map((option) => edge(`option:${option.id}`, option.id))
      )
    ).toEqual([]);
  });

  it("should give a scale one ordinary outgoing edge and bounded levels", () => {
    const scale = (levels: string[]) =>
      makeNode({ output: { kind: "scale", levels } });
    expect(validate(scale(["low", "high"]), [edge(null)])).toEqual([]);
    expect(validate(scale(["low", "high"]), [])).toEqual([
      'Classify "Triage" must have at least one outgoing edge.',
    ]);
    expect(validate(scale(["only"]), [edge(null)])).toEqual([
      'Classify "Triage" must define between 2 and 10 scale levels.',
    ]);
    expect(
      validate(scale(Array.from({ length: 11 }, (_, i) => `l${i}`)), [
        edge(null),
      ])
    ).toEqual(['Classify "Triage" must define between 2 and 10 scale levels.']);
    expect(
      validate(scale(Array.from({ length: 10 }, (_, i) => `l${i}`)), [
        edge(null),
      ])
    ).toEqual([]);
    expect(validate(scale(["low", " "]), [edge(null)])).toEqual([
      'Classify "Triage" must describe every scale level.',
    ]);
    expect(
      validate(scale(["low", "high"]), [edge(null), edge("true", "x")])
    ).toEqual([
      'Classify "Triage" has an edge from a branch that no longer exists.',
    ]);
  });

  it("should tie the uncertain branch to a confidence floor, both ways", () => {
    const uncertain = edge("uncertain", "u");
    expect(validate(makeNode({ minConfidence: 0.7 }), booleanEdges)).toEqual([
      'Classify "Triage" sets a minimum confidence, so it must wire the uncertain branch.',
    ]);
    expect(
      validate(makeNode({ minConfidence: 0.7 }), [...booleanEdges, uncertain])
    ).toEqual([]);
    expect(validate(makeNode(), [...booleanEdges, uncertain])).toEqual([
      'Classify "Triage" wires an uncertain branch but sets no minimum confidence.',
    ]);
  });

  it.each([0, 1, -0.2, 1.5])(
    "should reject a minimum confidence of %s",
    (minConfidence) => {
      expect(
        validate(makeNode({ minConfidence }), [
          ...booleanEdges,
          edge("uncertain", "u"),
        ])
      ).toEqual([
        'Classify "Triage" minimum confidence must be between 0 and 1.',
      ]);
    }
  );
});

describe("classifyOperator.coerceData", () => {
  it("should fill defaults for an empty node", () => {
    expect(classifyOperator.coerceData({})).toEqual({
      label: "Classify",
      input: "{{previous_outputs}}",
      question: "",
      output: { kind: "boolean" },
      resultKey: "",
      minConfidence: null,
    });
  });

  it("should keep authored values and trim the variable name", () => {
    expect(
      classifyOperator.coerceData({
        label: "Urgency",
        input: "{{metadata.body}}",
        question: "How urgent?",
        output: { kind: "scale", levels: ["low", 7, "high"] },
        resultKey: " urgency ",
        minConfidence: "0.6",
      })
    ).toEqual({
      label: "Urgency",
      input: "{{metadata.body}}",
      question: "How urgent?",
      output: { kind: "scale", levels: ["low", "high"] },
      resultKey: "urgency",
      minConfidence: 0.6,
    });
  });

  it("should derive stable, unique option ids when the author gave none", () => {
    const data = classifyOperator.coerceData({
      output: {
        kind: "choice",
        options: [
          "Bug report",
          { label: "Bug Report!" },
          { id: " keep ", label: "Kept", description: "as is" },
          { label: "???" },
          null,
          42,
        ],
      },
    });
    expect(data.output).toEqual({
      kind: "choice",
      options: [
        { id: "bug_report", label: "Bug report" },
        { id: "bug_report_2", label: "Bug Report!" },
        { id: "keep", label: "Kept", description: "as is" },
        { id: "option_4", label: "???" },
      ],
    });
  });

  it("should slug messy labels and number repeated ids in order", () => {
    const data = classifyOperator.coerceData({
      output: {
        kind: "choice",
        options: [
          { id: "   ", label: "  --Bug   report--  " },
          { label: "dup" },
          { label: "dup" },
          { label: "dup" },
          { label: 5, description: 7 },
        ],
      },
    });
    expect(data.output).toEqual({
      kind: "choice",
      options: [
        { id: "bug_report", label: "  --Bug   report--  " },
        { id: "dup", label: "dup" },
        { id: "dup_2", label: "dup" },
        { id: "dup_3", label: "dup" },
        { id: "option_5", label: "" },
      ],
    });
  });

  it("should fall back to safe shapes for malformed output", () => {
    expect(classifyOperator.coerceData({ output: null }).output).toEqual({
      kind: "boolean",
    });
    expect(classifyOperator.coerceData({ output: "choice" }).output).toEqual({
      kind: "boolean",
    });
    expect(
      classifyOperator.coerceData({ output: { kind: "choice", options: "x" } })
        .output
    ).toEqual({ kind: "choice", options: [] });
    expect(
      classifyOperator.coerceData({ output: { kind: "scale" } }).output
    ).toEqual({ kind: "scale", levels: [] });
    expect(
      classifyOperator.coerceData({ minConfidence: "abc" }).minConfidence
    ).toBeNull();
    expect(
      classifyOperator.coerceData({ minConfidence: " " }).minConfidence
    ).toBeNull();
  });
});

describe("classifyOperator.defaultData", () => {
  it("should number the label and variable, and honor a given label", () => {
    expect(classifyOperator.defaultData({ nextIndex: 2 })).toMatchObject({
      label: "Classify 2",
      resultKey: "classify_2",
      output: { kind: "boolean" },
      input: "{{previous_outputs}}",
    });
    expect(
      classifyOperator.defaultData({ nextIndex: 1, label: " Triage " }).label
    ).toBe("Triage");
  });
});

describe("classify handles", () => {
  const base = { confidence: 0.9, probabilities: {}, uncertain: false };

  it("should list the answer handles a node must wire", () => {
    expect(classifyAnswerHandles({ kind: "boolean" })).toEqual([
      "true",
      "false",
    ]);
    expect(
      classifyAnswerHandles({ kind: "choice", options: triageOptions })
    ).toEqual(["option:bug", "option:feature"]);
    expect(
      classifyAnswerHandles({ kind: "scale", levels: ["a", "b"] })
    ).toEqual([]);
  });

  it("should pick the handle an answer leaves through", () => {
    expect(
      classifyResultHandle({ ...base, kind: "boolean", answer: true })
    ).toBe("true");
    expect(
      classifyResultHandle({ ...base, kind: "boolean", answer: false })
    ).toBe("false");
    expect(
      classifyResultHandle({
        ...base,
        kind: "choice",
        answer: "Bug report",
        optionId: "bug",
      })
    ).toBe("option:bug");
    expect(
      classifyResultHandle({ ...base, kind: "scale", answer: 2, level: "b" })
    ).toBeNull();
    expect(
      classifyResultHandle({ ...base, kind: "choice", answer: "Bug report" })
    ).toBe("option:");
    expect(
      classifyResultHandle({
        ...base,
        kind: "boolean",
        answer: true,
        uncertain: true,
      })
    ).toBe("uncertain");
  });
});
