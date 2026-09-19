import { describe, expect, it } from "vitest";
import type { FlowGraph } from "@/lib/types";
import {
  addClassifyNodeParams,
  createAddClassifyNodeTool,
} from "./assistant-tools-classify";
import type { ToolContext } from "./assistant-tools-node-factories";
import { connectParams } from "./assistant-tools-schemas";

function makeContext(graphHydrated = true) {
  const graph: FlowGraph = { nodes: [], edges: [] };
  const ctx: ToolContext = {
    graph,
    graphHydrated,
    allowedAgentIds: new Set(),
    allowedModelIds: new Set(),
    defaultModelId: "model",
    mintId: (type) => `${type}-1`,
    autoPosition: () => ({ x: 10, y: 20 }),
    requireGraphHydrated: () =>
      graphHydrated ? null : { error: "Call getGraph first." },
    removeNodeByType: () => {},
  };
  return { ctx, graph };
}

const callOptions = { context: {}, toolCallId: "call-1", messages: [] };

describe("addClassifyNode tool", () => {
  it("should add a boolean node with defaults and report its handles", async () => {
    const { ctx, graph } = makeContext();
    const result = await createAddClassifyNodeTool(ctx).execute!(
      {
        label: "Is bug",
        question: "Is this a bug report?",
        output: { kind: "boolean" },
        resultKey: "is_bug",
      },
      callOptions
    );

    expect(result).toEqual({
      id: "classify-1",
      handles: { answers: ["true", "false"], error: "error" },
    });
    expect(graph.nodes).toEqual([
      {
        id: "classify-1",
        type: "classify",
        position: { x: 10, y: 20 },
        data: {
          label: "Is bug",
          question: "Is this a bug report?",
          input: "{{previous_outputs}}",
          output: { kind: "boolean" },
          resultKey: "is_bug",
          minConfidence: null,
        },
      },
    ]);
  });

  it("should report option and uncertain handles for a choice with a floor", async () => {
    const { ctx, graph } = makeContext();
    const result = await createAddClassifyNodeTool(ctx).execute!(
      {
        label: "Kind",
        question: "Which kind of issue is this?",
        input: "{{metadata.title}}",
        output: {
          kind: "choice",
          options: [
            { id: "bug", label: "Bug" },
            { id: "feature", label: "Feature" },
          ],
        },
        resultKey: "kind",
        minConfidence: 0.7,
        position: { x: 1, y: 2 },
      },
      callOptions
    );

    expect(result).toMatchObject({
      handles: {
        answers: ["option:bug", "option:feature"],
        uncertain: "uncertain",
      },
    });
    expect(graph.nodes[0]).toMatchObject({
      position: { x: 1, y: 2 },
      data: { input: "{{metadata.title}}", minConfidence: 0.7 },
    });
  });

  it("should report no answer handles for a scale and default a blank input", async () => {
    const { ctx, graph } = makeContext();
    const result = await createAddClassifyNodeTool(ctx).execute!(
      {
        label: "Urgency",
        question: "How urgent is this?",
        input: "   ",
        output: { kind: "scale", levels: ["low", "high"] },
        resultKey: "urgency",
      },
      callOptions
    );
    expect(result).toMatchObject({ handles: { answers: [] } });
    expect(graph.nodes[0]?.data).toMatchObject({
      input: "{{previous_outputs}}",
    });
  });

  it("should refuse to edit a graph that has not been loaded", async () => {
    const { ctx, graph } = makeContext(false);
    const result = await createAddClassifyNodeTool(ctx).execute!(
      {
        label: "x",
        question: "q?",
        output: { kind: "boolean" },
        resultKey: "x",
      },
      callOptions
    );
    expect(result).toEqual({ error: "Call getGraph first." });
    expect(graph.nodes).toHaveLength(0);
  });
});

describe("addClassifyNodeParams", () => {
  const base = { label: "x", question: "q?", resultKey: "x" };
  const parses = (value: unknown) =>
    addClassifyNodeParams.safeParse(value).success;

  it("should accept each answer type within the model's limits", () => {
    expect(parses({ ...base, output: { kind: "boolean" } })).toBe(true);
    expect(
      parses({ ...base, output: { kind: "scale", levels: ["a", "b"] } })
    ).toBe(true);
    expect(
      parses({
        ...base,
        output: {
          kind: "choice",
          options: [
            { id: "a", label: "A" },
            { id: "b-2", label: "B", description: "second" },
          ],
        },
      })
    ).toBe(true);
  });

  it("should reject malformed questions, variables, options, levels, and floors", () => {
    const boolean = { kind: "boolean" };
    expect(parses({ ...base, question: "", output: boolean })).toBe(false);
    expect(parses({ ...base, resultKey: "1x", output: boolean })).toBe(false);
    expect(parses({ ...base, output: boolean, minConfidence: 0 })).toBe(false);
    expect(parses({ ...base, output: boolean, minConfidence: 1 })).toBe(false);
    expect(parses({ ...base, output: { kind: "scale", levels: ["a"] } })).toBe(
      false
    );
    expect(
      parses({
        ...base,
        output: {
          kind: "scale",
          levels: Array.from({ length: 11 }, (_, index) => `l${index}`),
        },
      })
    ).toBe(false);
    expect(
      parses({
        ...base,
        output: { kind: "choice", options: [{ id: "a", label: "A" }] },
      })
    ).toBe(false);
    expect(
      parses({
        ...base,
        output: {
          kind: "choice",
          options: [
            { id: "has space", label: "A" },
            { id: "b", label: "B" },
          ],
        },
      })
    ).toBe(false);
    expect(
      parses({
        ...base,
        output: {
          kind: "choice",
          options: [
            { id: "a", label: "" },
            { id: "b", label: "B" },
          ],
        },
      })
    ).toBe(false);
  });
});

describe("connectParams", () => {
  const handle = (sourceHandle: string) =>
    connectParams.safeParse({ source: "a", target: "b", sourceHandle }).success;

  it("should accept classify branches alongside the existing handles", () => {
    for (const id of ["true", "false", "error", "uncertain", "option:bug-1"]) {
      expect(handle(id)).toBe(true);
    }
  });

  it("should reject handles no node has", () => {
    for (const id of ["maybe", "option:", "option:has space", "xoption:a"]) {
      expect(handle(id)).toBe(false);
    }
  });
});
