/**
 * The runtime shape of a roster agent: everything a run needs to behave as
 * that agent, independent of which entry point started the run.
 */

export const PRESET_AGENT_ID_PREFIX = "preset:";

export type AgentRuntimeSkill = {
  id: string;
  name: string;
  description: string | null;
  content: string;
};

export type AgentRuntimeRule = {
  id: string;
  name: string;
  content: string;
};

export type AgentRuntime = {
  /** Roster row id, or `preset:<NAME>` for a built-in template. */
  id: string;
  name: string;
  slug: string | null;
  /** Roster model. Advisory only: CLI harnesses bring their own model. */
  model: string | null;
  systemPrompt: string | null;
  skills: AgentRuntimeSkill[];
  rules: AgentRuntimeRule[];
  preset: boolean;
  /** Set when the agent is shared with a team rather than personal. */
  teamId: string | null;
  ownerUserId: string | null;
};

export type AgentRuntimeRow = {
  id: string;
  user_id: string | null;
  team_id: string | null;
  name: string;
  slug: string | null;
  model: string | null;
  system_prompt: string | null;
};

export function isPresetAgentId(id: string) {
  return id.startsWith(PRESET_AGENT_ID_PREFIX);
}

export function presetAgentName(id: string) {
  return id.slice(PRESET_AGENT_ID_PREFIX.length);
}
