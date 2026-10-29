import { describe, expect, it } from "vitest";
import { assertFutureRunAt, isValidRunAt } from "./one-time-config";
import { coerceGraph, validateFlowGraph } from "./graph";
import { scheduledTaskExample } from "@/lib/mogplex-api/automation-schema";

describe("one-time schedule configuration", () => {
  it("requires an unambiguous timestamp in the future when armed", () => {
    expect(isValidRunAt("2027-01-15T15:00:00-05:00")).toBe(true);
    for (const value of [
      "2027-02-30T15:00:00Z",
      "tomorrow",
      "2027-01-15T15:00:00",
      "2027-99-15T15:00:00Z",
      "",
    ]) {
      expect(isValidRunAt(value)).toBe(false);
    }
    expect(() =>
      assertFutureRunAt(
        "2027-01-15T15:00:00Z",
        Date.parse("2027-01-16T00:00:00Z")
      )
    ).toThrow(/future/);
    const now = Date.parse("2027-01-15T15:00:00Z");
    expect(() => assertFutureRunAt("2027-01-16T15:00:00Z", now)).not.toThrow();
    expect(() => assertFutureRunAt("2027-01-15T15:00:00Z", now)).toThrow(
      /future/
    );
    expect(() => assertFutureRunAt("not-a-date", now)).toThrow(/future/);
    expect(isValidRunAt("2028-02-29T15:00:00+05:30")).toBe(true);
  });

  it("preserves one-time timestamps and rejects ambiguous recurring schedules", () => {
    const graph = coerceGraph(structuredClone(scheduledTaskExample));
    const start = graph.nodes.find((node) => node.type === "start")!;
    const task = graph.nodes.find((node) => node.type === "agent")!;
    task.data.harness = "codex";
    task.data.agentId = null;
    start.data.scheduleRunAt = "2027-01-15T15:00:00-05:00";
    expect(validateFlowGraph(graph).errors.join(" ")).toMatch(
      /either run once/
    );
    delete start.data.scheduleCron;
    delete start.data.scheduleTimezone;
    const restored = coerceGraph(graph);
    expect(
      restored.nodes.find((node) => node.type === "start")!.data.scheduleRunAt
    ).toBe(start.data.scheduleRunAt);
    expect(validateFlowGraph(restored).errors).toEqual([]);
    restored.nodes.find((node) => node.type === "start")!.data.scheduleRunAt =
      "";
    expect(validateFlowGraph(restored).errors.join(" ")).toMatch(/Run once/);
  });
});
