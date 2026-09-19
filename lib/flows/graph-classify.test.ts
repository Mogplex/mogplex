import { describe, expect, it } from "vitest";
import { draftToGraph, insertFlowDraftNode } from "@/lib/flows/editor";
import { coerceGraph, validateFlowGraph } from "@/lib/flows/graph";
import { flowGraphPayloadSchema } from "@/lib/mogplex-api/automation-request";
import { automationGraphSchema } from "@/lib/mogplex-api/automation-schema";

function triageGraph(edges: Array<Record<string, unknown>>) {
  return {
    nodes: [
      {
        id: "start",
        type: "start",
        position: { x: 0, y: 0 },
        data: { label: "Issue opened", event: "issue_opened" },
      },
      {
        id: "triage",
        type: "classify",
        position: { x: 200, y: 0 },
        data: {
          label: "Triage",
          input: "{{metadata.title}}",
          question: "Which kind of issue is this?",
          output: {
            kind: "choice",
            options: ["Bug report", "Feature request"],
          },
          resultKey: "kind",
        },
      },
      {
        id: "note",
        type: "agent",
        position: { x: 400, y: 0 },
        data: {
          label: "Respond",
          agentId: "agent-1",
          role: "triage",
          modelOverride: "provider/model",
        },
      },
      {
        id: "end",
        type: "end",
        position: { x: 600, y: 0 },
        data: { label: "Done" },
      },
    ],
    edges,
  };
}

const wired = [
  { id: "e1", source: "start", target: "triage" },
  {
    id: "e2",
    source: "triage",
    target: "note",
    sourceHandle: "option:bug_report",
  },
  {
    id: "e3",
    source: "triage",
    target: "end",
    sourceHandle: "option:feature_request",
  },
  { id: "e4", source: "note", target: "end" },
];

describe("classify nodes in a flow graph", () => {
  it("should survive coercion with option ids derived from bare labels", () => {
    const graph = coerceGraph(triageGraph(wired));
    const node = graph.nodes.find((candidate) => candidate.id === "triage");
    expect(node).toMatchObject({
      type: "classify",
      data: {
        output: {
          kind: "choice",
          options: [
            { id: "bug_report", label: "Bug report" },
            { id: "feature_request", label: "Feature request" },
          ],
        },
        minConfidence: null,
      },
    });
  });

  it("should validate a fully wired graph, with or without an error branch", () => {
    expect(validateFlowGraph(coerceGraph(triageGraph(wired)))).toMatchObject({
      valid: true,
      errors: [],
    });
    const withRecovery = [
      ...wired,
      { id: "e5", source: "triage", target: "end", sourceHandle: "error" },
    ];
    expect(
      validateFlowGraph(coerceGraph(triageGraph(withRecovery))).errors
    ).toEqual([]);
  });

  it("should report an option that has no branch", () => {
    const missing = wired.filter((edge) => edge.id !== "e3");
    expect(
      validateFlowGraph(coerceGraph(triageGraph(missing))).errors
    ).toContain('Classify "Triage" must wire a branch for every option.');
  });
});

describe("classify nodes in the editor", () => {
  const emptyDraft = {
    name: "Flow",
    description: "",
    notes: "",
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    selectedNodeId: null,
  };

  it("should insert with defaults and keep its type when the draft is saved", () => {
    const { snapshot } = insertFlowDraftNode(emptyDraft, "classify", {
      idFactory: () => "abc",
      position: { x: 5, y: 6 },
    });
    const graph = draftToGraph(snapshot);

    expect(graph.nodes).toEqual([
      {
        id: "classify-abc",
        type: "classify",
        position: { x: 5, y: 6 },
        data: {
          label: "Classify 1",
          input: "{{previous_outputs}}",
          question: "",
          output: { kind: "boolean" },
          resultKey: "classify_1",
          minConfidence: null,
        },
      },
    ]);
  });
});

describe("classify nodes in the public API", () => {
  it("should accept a classify node in a graph payload", () => {
    expect(flowGraphPayloadSchema.safeParse(triageGraph(wired)).success).toBe(
      true
    );
  });

  it("should document the node and its handles in the published schema", () => {
    const schema = JSON.stringify(automationGraphSchema);
    expect(schema).toContain('"classify"');
    expect(schema).toContain("option:<id>");
    expect(schema).toContain("resultKey");
  });
});
