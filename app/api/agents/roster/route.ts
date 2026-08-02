import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUserId } from "@/lib/auth";
import { PRECONFIGURED_AGENTS } from "@/lib/agents/templates";

// No `model`: an agent is identity and prompt. Which model a step runs on is a
// property of the automation node that uses the agent, not of the agent — see
// the agent node's modelOverride. Reporting `agents.model` here would show a
// value no run reads.
export type AgentRosterItem = {
  id: string;
  name: string;
  description: string;
  status: "running" | "idle" | "error";
  cycleCount: number;
  lastActivity: string | null;
};

export async function GET() {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  const { data: dbAgents, error: agentsErr } = await supabaseAdmin
    .from("agents")
    .select("id, name, description, source_template")
    .eq("user_id", userId);

  if (agentsErr)
    return NextResponse.json({ error: agentsErr.message }, { status: 500 });

  // Merge preset agents with DB agents (skip presets that have a fork).
  const forkedTemplates = new Set(
    (dbAgents ?? [])
      .filter((a) => a.source_template)
      .map((a) => a.source_template)
  );
  const presetAgents = PRECONFIGURED_AGENTS.filter(
    (t) => !forkedTemplates.has(t.name)
  ).map((t) => ({
    id: `preset:${t.name}`,
    name: t.name,
    description: t.description,
  }));

  const agents = [...presetAgents, ...(dbAgents ?? [])];
  if (agents.length === 0) return NextResponse.json([]);

  const callsRes = await supabaseAdmin
    .from("ai_calls")
    .select("metadata, status, started_at")
    .eq("user_id", userId)
    .order("started_at", { ascending: false })
    .limit(500);

  const callsByAgent = new Map<
    string,
    { count: number; latestStatus: string; latestAt: string }
  >();
  for (const call of callsRes.data || []) {
    const agentId = (call.metadata as Record<string, unknown>)?.agent_id as
      | string
      | undefined;
    if (!agentId) continue;
    const existing = callsByAgent.get(agentId);
    if (existing) {
      existing.count++;
    } else {
      callsByAgent.set(agentId, {
        count: 1,
        latestStatus: call.status,
        latestAt: call.started_at,
      });
    }
  }

  const roster: AgentRosterItem[] = agents.map((agent) => {
    const calls = callsByAgent.get(agent.id);
    let status: AgentRosterItem["status"] = "idle";
    if (calls?.latestStatus === "streaming") status = "running";
    else if (calls?.latestStatus === "failed") status = "error";

    return {
      id: agent.id,
      name: agent.name,
      description: agent.description || "",
      status,
      cycleCount: calls?.count || 0,
      lastActivity: calls?.latestAt || null,
    };
  });

  return NextResponse.json(roster);
}
