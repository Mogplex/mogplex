/**
 * Storage for the agents API. Every function takes a client so route tests
 * can hand in fakes without mocking internal modules.
 */
import { supabaseAdmin } from "@/lib/supabase/admin";

type Client = Pick<typeof supabaseAdmin, "from">;

export type AgentRow = {
  id: string;
  user_id: string;
  team_id: string | null;
  name: string;
  slug: string | null;
  model: string;
  system_prompt: string | null;
  description: string | null;
  category: string | null;
  source_template: string | null;
  created_at: string;
};

export type AgentLinks = { skill_ids: string[]; rule_ids: string[] };

export class AgentLinkValidationError extends Error {
  status = 400;
}

/**
 * Own rows plus, in team scope, rows other members shared with that team.
 * Own rows include the ones the user shared, so nothing disappears when the
 * scope toggle flips.
 */
export async function listAgentsForScope(
  input: { userId: string; teamId: string | null },
  client: Client = supabaseAdmin
): Promise<AgentRow[]> {
  const [own, shared] = await Promise.all([
    client
      .from("agents")
      .select("*")
      .eq("user_id", input.userId)
      .order("name")
      .limit(200),
    input.teamId
      ? client
          .from("agents")
          .select("*")
          .eq("team_id", input.teamId)
          .neq("user_id", input.userId)
          .order("name")
          .limit(200)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (own.error) throw new Error(own.error.message);
  if (shared.error) throw new Error(shared.error.message);
  return [
    ...((own.data ?? []) as unknown as AgentRow[]),
    ...((shared.data ?? []) as unknown as AgentRow[]),
  ];
}

export async function loadAgentById(
  agentId: string,
  client: Client = supabaseAdmin
): Promise<AgentRow | null> {
  const { data, error } = await client
    .from("agents")
    .select("*")
    .eq("id", agentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as AgentRow | null) ?? null;
}

export async function loadAgentLinks(
  agentIds: string[],
  client: Client = supabaseAdmin
): Promise<Map<string, AgentLinks>> {
  const links = new Map<string, AgentLinks>();
  if (agentIds.length === 0) return links;
  const [skills, rules] = await Promise.all([
    client
      .from("agent_skill_links")
      .select("agent_id, skill_id, position")
      .in("agent_id", agentIds)
      .order("position", { ascending: true }),
    client
      .from("agent_rule_links")
      .select("agent_id, rule_id, position")
      .in("agent_id", agentIds)
      .order("position", { ascending: true }),
  ]);
  if (skills.error) throw new Error(skills.error.message);
  if (rules.error) throw new Error(rules.error.message);
  const entry = (agentId: string) => {
    const existing = links.get(agentId);
    if (existing) return existing;
    const created = { skill_ids: [], rule_ids: [] };
    links.set(agentId, created);
    return created;
  };
  for (const row of (skills.data ?? []) as Array<{
    agent_id: string;
    skill_id: string;
  }>) {
    entry(row.agent_id).skill_ids.push(row.skill_id);
  }
  for (const row of (rules.data ?? []) as Array<{
    agent_id: string;
    rule_id: string;
  }>) {
    entry(row.agent_id).rule_ids.push(row.rule_id);
  }
  return links;
}

async function assertOwnedIds(
  client: Client,
  table: "skills" | "agent_rules",
  userId: string,
  ids: string[],
  label: string
) {
  if (ids.length === 0) return;
  const { data, error } = await client
    .from(table)
    .select("id")
    .eq("user_id", userId)
    .in("id", ids);
  if (error) throw new Error(error.message);
  const found = new Set(
    ((data ?? []) as Array<{ id: string }>).map((r) => r.id)
  );
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new AgentLinkValidationError(
      `Unknown ${label}: ${missing.join(", ")}`
    );
  }
}

/**
 * Replaces an agent's attachments. Only the editor's own skills and rules can
 * be attached; a teammate editing a shared agent attaches from their library.
 */
export async function replaceAgentLinks(
  input: {
    agentId: string;
    userId: string;
    skillIds?: string[];
    ruleIds?: string[];
  },
  client: Client = supabaseAdmin
): Promise<void> {
  const skillIds = input.skillIds ? Array.from(new Set(input.skillIds)) : null;
  const ruleIds = input.ruleIds ? Array.from(new Set(input.ruleIds)) : null;
  await Promise.all([
    skillIds
      ? assertOwnedIds(client, "skills", input.userId, skillIds, "skills")
      : null,
    ruleIds
      ? assertOwnedIds(client, "agent_rules", input.userId, ruleIds, "rules")
      : null,
  ]);
  if (skillIds) {
    const removed = await client
      .from("agent_skill_links")
      .delete()
      .eq("agent_id", input.agentId);
    if (removed.error) throw new Error(removed.error.message);
    if (skillIds.length > 0) {
      const inserted = await client.from("agent_skill_links").insert(
        skillIds.map((skillId, position) => ({
          agent_id: input.agentId,
          skill_id: skillId,
          position,
        }))
      );
      if (inserted.error) throw new Error(inserted.error.message);
    }
  }
  if (ruleIds) {
    const removed = await client
      .from("agent_rule_links")
      .delete()
      .eq("agent_id", input.agentId);
    if (removed.error) throw new Error(removed.error.message);
    if (ruleIds.length > 0) {
      const inserted = await client.from("agent_rule_links").insert(
        ruleIds.map((ruleId, position) => ({
          agent_id: input.agentId,
          rule_id: ruleId,
          position,
        }))
      );
      if (inserted.error) throw new Error(inserted.error.message);
    }
  }
}

export async function insertAgent(
  values: Record<string, unknown>,
  client: Client = supabaseAdmin
): Promise<AgentRow> {
  const { data, error } = await client
    .from("agents")
    .insert(values)
    .select()
    .single();
  if (error || !data) throw new Error(error?.message ?? "Insert failed");
  return data as AgentRow;
}

export async function updateAgent(
  agentId: string,
  values: Record<string, unknown>,
  client: Client = supabaseAdmin
): Promise<AgentRow> {
  const { data, error } = await client
    .from("agents")
    .update(values)
    .eq("id", agentId)
    .select()
    .single();
  if (error || !data) throw new Error(error?.message ?? "Update failed");
  return data as AgentRow;
}

export async function deleteOwnedAgent(
  agentId: string,
  userId: string,
  client: Client = supabaseAdmin
): Promise<void> {
  const { error } = await client
    .from("agents")
    .delete()
    .eq("id", agentId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
}

export type PublishedFlowForUsage = {
  id: string;
  name: string;
  status: string;
  graph: unknown;
};

/** Flows the user owns that have a published graph, with that graph. */
export async function listPublishedFlowsForUsage(
  userId: string,
  client: Client = supabaseAdmin
): Promise<PublishedFlowForUsage[]> {
  const flows = await client
    .from("flows")
    .select("id, name, status, published_version_id")
    .eq("user_id", userId);
  if (flows.error) throw new Error(flows.error.message);
  const rows = (flows.data ?? []) as Array<{
    id: string;
    name: string;
    status: string;
    published_version_id: string | null;
  }>;
  const versionIds = rows
    .map((row) => row.published_version_id)
    .filter(Boolean);
  if (versionIds.length === 0) return [];
  const versions = await client
    .from("flow_versions")
    .select("id, graph")
    .in("id", versionIds);
  if (versions.error) throw new Error(versions.error.message);
  const graphById = new Map(
    ((versions.data ?? []) as Array<{ id: string; graph: unknown }>).map(
      (row) => [row.id, row.graph]
    )
  );
  return rows
    .filter((row) => row.published_version_id)
    .map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      graph: graphById.get(row.published_version_id!) ?? null,
    }));
}

export type AgentRunForUsage = { agent_id: string; created_at: string };

export async function listAgentRunsForUsage(
  userId: string,
  client: Client = supabaseAdmin
): Promise<AgentRunForUsage[]> {
  const { data, error } = await client
    .from("external_agent_runs")
    .select("agent_id, created_at")
    .eq("user_id", userId)
    .not("agent_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(2000);
  if (error) throw new Error(error.message);
  return (data ?? []) as AgentRunForUsage[];
}

export { listUserTeamIds } from "@/lib/agents/runtime/store";
