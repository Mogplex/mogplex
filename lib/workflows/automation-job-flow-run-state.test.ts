import { describe, expect, it } from "vitest";
import type { FlowGraph } from "@/lib/types";
import { emitToOutgoing } from "./automation-job-flow-run-state";

const graph: FlowGraph = {
  nodes: [],
  edges: [
    { id: "ok", source: "notify", target: "next" },
    { id: "also-ok", source: "notify", target: "audit", sourceHandle: null },
    { id: "err", source: "notify", target: "recover", sourceHandle: "error" },
    { id: "other", source: "elsewhere", target: "next" },
  ],
};

function byTarget(emitted: ReturnType<typeof emitToOutgoing>) {
  return Object.fromEntries(emitted.map((item) => [item.targetId, item.token]));
}

describe("emitToOutgoing", () => {
  it("should tell the error branch it will not run when a node succeeds", () => {
    const tokens = byTarget(
      emitToOutgoing(graph, "notify", "Notify", "sent", false, { id: 1 })
    );

    expect(tokens.next).toEqual({
      fromNodeId: "notify",
      label: "Notify",
      text: "sent",
      skipped: false,
      payload: { id: 1 },
    });
    expect(tokens.audit).toMatchObject({ skipped: false, text: "sent" });
    expect(tokens.recover).toEqual({
      fromNodeId: "notify",
      label: "Notify",
      text: 'Skipped because "Notify" did not fail',
      skipped: true,
      payload: null,
    });
    expect(Object.keys(tokens)).toEqual(["next", "audit", "recover"]);
  });

  it("should activate the error branch when failure routing selects it", () => {
    const emitted = emitToOutgoing(
      graph,
      "notify",
      "Notify",
      "Slack unavailable",
      false,
      { error: "Slack unavailable" },
      (edge) => edge.sourceHandle === "error"
    );

    expect(emitted).toEqual([
      {
        targetId: "recover",
        token: {
          fromNodeId: "notify",
          label: "Notify",
          text: "Slack unavailable",
          skipped: false,
          payload: { error: "Slack unavailable" },
        },
      },
    ]);
  });

  it("should keep the caller's reason when every branch is skipped", () => {
    const tokens = byTarget(
      emitToOutgoing(graph, "notify", "Notify", "upstream skipped", true)
    );

    expect(tokens.recover).toMatchObject({
      skipped: true,
      text: "upstream skipped",
    });
    expect(tokens.next).toMatchObject({ skipped: true, payload: null });
  });
});
