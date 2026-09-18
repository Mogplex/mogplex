/**
 * Resolves an agent id to its runtime shape for the user starting a run.
 *
 * Access: the caller owns the agent, or the agent is shared with a team the
 * caller belongs to. Presets (`preset:<NAME>`) resolve from the built-in
 * template catalog and carry no skills or rules. Anything else is `null`,
 * which callers surface as "not found" so shared ids never leak by error text.
 */
import { PRECONFIGURED_AGENTS } from "@/lib/agents/templates";
import {
  isPresetAgentId,
  presetAgentName,
  type AgentRuntime,
  type AgentRuntimeRow,
  type AgentRuntimeRule,
  type AgentRuntimeSkill,
} from "./types";

export type ResolveAgentRuntimeDeps = {
  loadAgent: (agentId: string) => Promise<AgentRuntimeRow | null>;
  loadLinkedSkills: (agentId: string) => Promise<AgentRuntimeSkill[]>;
  loadLinkedRules: (agentId: string) => Promise<AgentRuntimeRule[]>;
  isTeamMember: (teamId: string, userId: string) => Promise<boolean>;
};

export function resolvePresetAgentRuntime(
  agentId: string
): AgentRuntime | null {
  if (!isPresetAgentId(agentId)) return null;
  const name = presetAgentName(agentId);
  const template = PRECONFIGURED_AGENTS.find((entry) => entry.name === name);
  if (!template) return null;
  return {
    id: agentId,
    name: template.name,
    slug: null,
    model: template.model,
    systemPrompt: template.system_prompt,
    skills: [],
    rules: [],
    preset: true,
    teamId: null,
    ownerUserId: null,
  };
}

export async function canUserAccessAgent(
  row: Pick<AgentRuntimeRow, "user_id" | "team_id">,
  userId: string,
  isTeamMember: ResolveAgentRuntimeDeps["isTeamMember"]
) {
  if (row.user_id === userId) return true;
  if (!row.team_id) return false;
  return isTeamMember(row.team_id, userId);
}

export async function resolveAgentRuntime(
  input: { agentId: string; userId: string },
  deps: ResolveAgentRuntimeDeps
): Promise<AgentRuntime | null> {
  const preset = resolvePresetAgentRuntime(input.agentId);
  if (preset) return preset;
  if (isPresetAgentId(input.agentId)) return null;

  const row = await deps.loadAgent(input.agentId);
  if (!row) return null;
  if (!(await canUserAccessAgent(row, input.userId, deps.isTeamMember))) {
    return null;
  }
  const [skills, rules] = await Promise.all([
    deps.loadLinkedSkills(row.id),
    deps.loadLinkedRules(row.id),
  ]);
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    model: row.model,
    systemPrompt: row.system_prompt,
    skills,
    rules,
    preset: false,
    teamId: row.team_id,
    ownerUserId: row.user_id,
  };
}
