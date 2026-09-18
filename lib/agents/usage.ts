/**
 * Pure aggregation of where a roster agent is used: published automations
 * whose graph binds it, and runs that recorded it.
 */

export type AgentUsageAutomation = { id: string; name: string; status: string };

export type AgentUsage = {
  automations: AgentUsageAutomation[];
  runs: number;
  lastRunAt: string | null;
};

export type AgentUsageMap = Record<string, AgentUsage>;

type FlowLike = { id: string; name: string; status: string; graph: unknown };
type RunLike = { agent_id: string; created_at: string };

/** Agent ids referenced by any agent node in a stored flow graph. */
export function collectGraphAgentIds(graph: unknown): string[] {
  if (!graph || typeof graph !== "object") return [];
  const nodes = (graph as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) return [];
  const ids = new Set<string>();
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    const typed = node as { type?: unknown; data?: { agentId?: unknown } };
    if (typed.type !== "agent") continue;
    const agentId = typed.data?.agentId;
    if (typeof agentId === "string" && agentId.length > 0) ids.add(agentId);
  }
  return Array.from(ids);
}

function entry(map: AgentUsageMap, agentId: string): AgentUsage {
  const existing = map[agentId];
  if (existing) return existing;
  const created: AgentUsage = { automations: [], runs: 0, lastRunAt: null };
  map[agentId] = created;
  return created;
}

export function summarizeAgentUsage(input: {
  flows: FlowLike[];
  runs: RunLike[];
}): AgentUsageMap {
  const usage: AgentUsageMap = {};
  for (const flow of input.flows) {
    for (const agentId of collectGraphAgentIds(flow.graph)) {
      entry(usage, agentId).automations.push({
        id: flow.id,
        name: flow.name,
        status: flow.status,
      });
    }
  }
  for (const run of input.runs) {
    const item = entry(usage, run.agent_id);
    item.runs += 1;
    if (
      !item.lastRunAt ||
      Date.parse(run.created_at) > Date.parse(item.lastRunAt)
    ) {
      item.lastRunAt = run.created_at;
    }
  }
  return usage;
}
