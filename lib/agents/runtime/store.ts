/**
 * Supabase-backed loaders for agent runtime resolution and roster access.
 * Every function takes a client so tests can pass the PostgREST shim.
 */
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolveAgentRuntime, type ResolveAgentRuntimeDeps } from "./resolve";
import type {
  AgentRuntime,
  AgentRuntimeRow,
  AgentRuntimeRule,
  AgentRuntimeSkill,
} from "./types";

type Client = Pick<typeof supabaseAdmin, "from">;

const AGENT_RUNTIME_SELECT =
  "id, user_id, team_id, name, slug, model, system_prompt";

function firstEmbedded<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export async function loadAgentRuntimeRow(
  agentId: string,
  client: Client = supabaseAdmin
): Promise<AgentRuntimeRow | null> {
  const { data, error } = await client
    .from("agents")
    .select(AGENT_RUNTIME_SELECT)
    .eq("id", agentId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load agent: ${error.message}`);
  return (data as AgentRuntimeRow | null) ?? null;
}

export async function loadAgentLinkedSkills(
  agentId: string,
  client: Client = supabaseAdmin
): Promise<AgentRuntimeSkill[]> {
  const { data, error } = await client
    .from("agent_skill_links")
    .select("position, skill:skills(id, name, description, content)")
    .eq("agent_id", agentId)
    .order("position", { ascending: true });
  if (error) throw new Error(`Failed to load agent skills: ${error.message}`);
  const rows = (data ?? []) as Array<{
    skill: AgentRuntimeSkill | AgentRuntimeSkill[] | null;
  }>;
  const skills: AgentRuntimeSkill[] = [];
  for (const row of rows) {
    const skill = firstEmbedded(row.skill);
    if (!skill) continue;
    skills.push({
      id: skill.id,
      name: skill.name,
      description: skill.description ?? null,
      content: skill.content ?? "",
    });
  }
  return skills;
}

export async function loadAgentLinkedRules(
  agentId: string,
  client: Client = supabaseAdmin
): Promise<AgentRuntimeRule[]> {
  const { data, error } = await client
    .from("agent_rule_links")
    .select("position, rule:agent_rules(id, name, content)")
    .eq("agent_id", agentId)
    .order("position", { ascending: true });
  if (error) throw new Error(`Failed to load agent rules: ${error.message}`);
  const rows = (data ?? []) as Array<{
    rule: AgentRuntimeRule | AgentRuntimeRule[] | null;
  }>;
  const rules: AgentRuntimeRule[] = [];
  for (const row of rows) {
    const rule = firstEmbedded(row.rule);
    if (!rule) continue;
    rules.push({ id: rule.id, name: rule.name, content: rule.content ?? "" });
  }
  return rules;
}

export async function isTeamMember(
  teamId: string,
  userId: string,
  client: Client = supabaseAdmin
): Promise<boolean> {
  const { data, error } = await client
    .from("team_members")
    .select("user_id")
    .eq("team_id", teamId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error)
    throw new Error(`Failed to check team membership: ${error.message}`);
  return Boolean(data);
}

export async function listUserTeamIds(
  userId: string,
  client: Client = supabaseAdmin
): Promise<string[]> {
  const { data, error } = await client
    .from("team_members")
    .select("team_id")
    .eq("user_id", userId);
  if (error)
    throw new Error(`Failed to list team memberships: ${error.message}`);
  return ((data ?? []) as Array<{ team_id: string }>).map((row) => row.team_id);
}

/**
 * Agents the user can run: their own rows plus rows shared with any team
 * they belong to. Presets are not included; callers add them when listing.
 */
export async function listAccessibleAgentRows<T extends AgentRuntimeRow>(
  input: { userId: string; select?: string },
  client: Client = supabaseAdmin
): Promise<T[]> {
  const select = input.select ?? AGENT_RUNTIME_SELECT;
  const teamIds = await listUserTeamIds(input.userId, client);
  const [own, shared] = await Promise.all([
    client
      .from("agents")
      .select(select)
      .eq("user_id", input.userId)
      .order("name")
      .limit(200),
    teamIds.length > 0
      ? client
          .from("agents")
          .select(select)
          .in("team_id", teamIds)
          .neq("user_id", input.userId)
          .order("name")
          .limit(200)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (own.error) throw new Error(`Failed to list agents: ${own.error.message}`);
  if (shared.error) {
    throw new Error(`Failed to list shared agents: ${shared.error.message}`);
  }
  return [
    ...((own.data ?? []) as unknown as T[]),
    ...((shared.data ?? []) as unknown as T[]),
  ];
}

export function createResolveAgentRuntimeDeps(
  client: Client = supabaseAdmin
): ResolveAgentRuntimeDeps {
  return {
    loadAgent: (agentId) => loadAgentRuntimeRow(agentId, client),
    loadLinkedSkills: (agentId) => loadAgentLinkedSkills(agentId, client),
    loadLinkedRules: (agentId) => loadAgentLinkedRules(agentId, client),
    isTeamMember: (teamId, userId) => isTeamMember(teamId, userId, client),
  };
}

/** Resolves a roster or preset agent for a user with production loaders. */
export async function resolveAgentRuntimeForUser(
  input: { agentId: string; userId: string },
  client: Client = supabaseAdmin
): Promise<AgentRuntime | null> {
  return resolveAgentRuntime(input, createResolveAgentRuntimeDeps(client));
}
