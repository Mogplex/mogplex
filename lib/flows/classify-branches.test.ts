import { describe, expect, it } from "vitest";
import type { FlowClassifyNodeData } from "@/lib/types";
import {
  classifyBranchRows,
  classifyKindLabel,
  pruneClassifyEdges,
} from "./classify-branches";

function data(overrides: Partial<FlowClassifyNodeData>): FlowClassifyNodeData {
  return {
    label: "Triage",
    input: "{{previous_outputs}}",
    question: "Is this a bug?",
    output: { kind: "boolean" },
    resultKey: "triage",
    minConfidence: null,
    ...overrides,
  };
}

const choice = data({
  output: {
    kind: "choice",
    options: [
      { id: "bug", label: "Bug report" },
      { id: "blank", label: "" },
    ],
  },
});

describe("classifyKindLabel", () => {
  it("should name each answer type, with the scale's range", () => {
    expect(classifyKindLabel({ kind: "boolean" })).toBe("True / false");
    expect(classifyKindLabel(choice.output)).toBe("Single choice");
    expect(classifyKindLabel({ kind: "scale", levels: ["a", "b", "c"] })).toBe(
      "Scale 1 to 3"
    );
  });
});

describe("classifyBranchRows", () => {
  it("should list true, false, then the error branch for a boolean", () => {
    expect(classifyBranchRows(data({}))).toEqual([
      { handleId: "true", label: "True", tone: "answer" },
      { handleId: "false", label: "False", tone: "answer" },
      { handleId: "error", label: "On error", tone: "error" },
    ]);
  });

  it("should list one row per option and name a blank one", () => {
    expect(classifyBranchRows(choice)).toEqual([
      { handleId: "option:bug", label: "Bug report", tone: "answer" },
      { handleId: "option:blank", label: "Unnamed option", tone: "answer" },
      { handleId: "error", label: "On error", tone: "error" },
    ]);
  });

  it("should give a scale one ordinary branch", () => {
    expect(
      classifyBranchRows(
        data({ output: { kind: "scale", levels: ["a", "b"] } })
      )
    ).toEqual([
      { handleId: null, label: "Score", tone: "answer" },
      { handleId: "error", label: "On error", tone: "error" },
    ]);
  });

  it("should add the uncertain branch only when a confidence floor is set", () => {
    const rows = classifyBranchRows(data({ minConfidence: 0.7 }));
    expect(rows.map((row) => row.handleId)).toEqual([
      "true",
      "false",
      "uncertain",
      "error",
    ]);
    expect(rows[2]).toEqual({
      handleId: "uncertain",
      label: "Uncertain",
      tone: "uncertain",
    });
  });
});

describe("pruneClassifyEdges", () => {
  const edges = [
    { id: "1", source: "classify-1", sourceHandle: "true" },
    { id: "2", source: "classify-1", sourceHandle: "option:bug" },
    { id: "3", source: "classify-1", sourceHandle: "uncertain" },
    { id: "4", source: "classify-1", sourceHandle: "error" },
    { id: "5", source: "classify-1" },
    { id: "6", source: "other", sourceHandle: "option:gone" },
  ];
  const kept = (node: FlowClassifyNodeData) =>
    pruneClassifyEdges("classify-1", node, edges).map((edge) => edge.id);

  it("should keep only the branches a boolean node still has", () => {
    expect(kept(data({}))).toEqual(["1", "4", "6"]);
  });

  it("should keep option, uncertain, and error branches that still exist", () => {
    expect(kept({ ...choice, minConfidence: 0.6 })).toEqual([
      "2",
      "3",
      "4",
      "6",
    ]);
  });

  it("should keep a scale's ordinary edge and never touch other nodes", () => {
    expect(
      kept(data({ output: { kind: "scale", levels: ["a", "b"] } }))
    ).toEqual(["4", "5", "6"]);
  });
});
