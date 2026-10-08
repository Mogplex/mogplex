import { describe, expect, it } from "vitest";
import { coerceGraph, validateFlowGraph } from "@/lib/flows/graph";
import type { TriggerEvent } from "@/lib/types";

function taskGraph(event: TriggerEvent) {
  return coerceGraph({
    nodes: [
      {
        id: "start",
        type: "start",
        position: { x: 0, y: 0 },
        data: {
          label: "Start",
          event,
          filter: { scope: "org", installationIds: [7], repos: ["acme/site"] },
          ...(event === "schedule" ? { scheduleCron: "0 9 * * 1" } : {}),
          ...(event === "api"
            ? { inputFields: [{ key: "slug", type: "string", required: true }] }
            : {}),
        },
      },
      {
        id: "build",
        type: "agent",
        position: { x: 300, y: 0 },
        data: {
          label: "Build",
          role: "task",
          harness: "codex",
          agentId: null,
          systemPromptOverride: "Build the site.",
        },
      },
      {
        id: "end",
        type: "end",
        position: { x: 600, y: 0 },
        data: { label: "Done" },
      },
    ],
    edges: [
      { id: "e1", source: "start", target: "build" },
      { id: "e2", source: "build", target: "end" },
    ],
  });
}

describe("task node triggers", () => {
  it.each(["schedule", "api"] as const)(
    "should accept a task node under a %s trigger",
    (event) => {
      expect(validateFlowGraph(taskGraph(event)).errors).not.toContainEqual(
        expect.stringMatching(/requires a schedule or API trigger/)
      );
    }
  );

  it("should reject a task node under a pull request trigger", () => {
    expect(validateFlowGraph(taskGraph("pr_opened")).errors).toContain(
      'Task node "Build" requires a schedule or API trigger.'
    );
  });
});
