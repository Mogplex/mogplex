// The roster has no model: an agent is identity and prompt. Model selection is
// a property of the automation node or run that uses the agent.
export type AgentRosterItem = {
  id: string;
  name: string;
  description: string;
  status: "running" | "idle" | "error";
  cycleCount: number;
  lastActivity: string | null;
};

export type AgentRosterSummaryItem = {
  agentId: string;
  runs24h: number;
  succeeded: number;
  failed: number;
  suppressed: number;
  tokens24h: number;
};

export type AgentRosterSummaryResponse = Record<string, AgentRosterSummaryItem>;
