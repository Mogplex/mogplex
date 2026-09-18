import { describe, expect, it } from "vitest";
import { collectGraphAgentIds, summarizeAgentUsage } from "./usage";

const graph = {
  nodes: [
    { id: "start", type: "start", data: {} },
    { id: "a", type: "agent", data: { agentId: "agent-1" } },
    { id: "b", type: "agent", data: { agentId: "agent-1" } },
    { id: "c", type: "agent", data: { agentId: "preset:PR-REVIEWER" } },
    { id: "d", type: "agent", data: { agentId: null } },
    { id: "e", type: "end", data: { agentId: "ignored" } },
  ],
};

describe("collectGraphAgentIds", () => {
  it("returns each bound agent once and ignores non-agent nodes", () => {
    expect(collectGraphAgentIds(graph)).toEqual([
      "agent-1",
      "preset:PR-REVIEWER",
    ]);
  });

  it("tolerates malformed graphs", () => {
    expect(collectGraphAgentIds(null)).toEqual([]);
    expect(collectGraphAgentIds({ nodes: "nope" })).toEqual([]);
    expect(collectGraphAgentIds({ nodes: [null, 1] })).toEqual([]);
  });
});

describe("summarizeAgentUsage", () => {
  it("lists automations per agent and counts runs with the newest timestamp", () => {
    const usage = summarizeAgentUsage({
      flows: [
        { id: "flow-1", name: "PR-Review", status: "active", graph },
        {
          id: "flow-2",
          name: "Drift",
          status: "inactive",
          graph: { nodes: [] },
        },
      ],
      runs: [
        { agent_id: "agent-1", created_at: "2026-09-10T00:00:00.000Z" },
        { agent_id: "agent-1", created_at: "2026-09-17T00:00:00.000Z" },
        { agent_id: "agent-9", created_at: "2026-09-01T00:00:00.000Z" },
      ],
    });
    expect(usage["agent-1"]).toEqual({
      automations: [{ id: "flow-1", name: "PR-Review", status: "active" }],
      runs: 2,
      lastRunAt: "2026-09-17T00:00:00.000Z",
    });
    expect(usage["preset:PR-REVIEWER"]).toEqual({
      automations: [{ id: "flow-1", name: "PR-Review", status: "active" }],
      runs: 0,
      lastRunAt: null,
    });
    expect(usage["agent-9"]).toEqual({
      automations: [],
      runs: 1,
      lastRunAt: "2026-09-01T00:00:00.000Z",
    });
    expect(usage["flow-2"]).toBeUndefined();
  });
});
