import type { Tool } from "ai";
import { buildTools } from "@/lib/agents/tools";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { Capability } from "@/lib/team-capabilities";
import type { ResearchClaims } from "./research-auth";
import { HARNESS_LOCAL_TOOLS } from "./mogplex-tool-names";

export type HarnessToolRun = {
  userId: string;
  aiCallId: string;
  sandboxRecordId: string;
  repoId: string | null;
  teamId: string | null;
  conversationId: string | null;
};

type SandboxRepoRow = {
  working_branch: string | null;
  base_branch: string | null;
  repo: { full_name: string } | { full_name: string }[] | null;
};

async function loadSandboxRepo(
  run: HarnessToolRun
): Promise<SandboxRepoRow | null> {
  const { data } = await supabaseAdmin
    .from("sandboxes")
    .select("working_branch, base_branch, repo:repos(full_name)")
    .eq("id", run.sandboxRecordId)
    .eq("user_id", run.userId)
    .maybeSingle();
  return (data as SandboxRepoRow | null) ?? null;
}

const defaultDeps = { buildTools, loadSandboxRepo };

/** Read the harness run's scope back out of its authorized ai_call. */
export function harnessToolRunFromCall(
  claims: ResearchClaims,
  call: {
    repo_id: string | null;
    conversation_id: string | null;
    metadata: Record<string, unknown>;
  }
): HarnessToolRun {
  const teamId = call.metadata?.product_team_id;
  return {
    userId: claims.userId,
    aiCallId: claims.aiCallId,
    sandboxRecordId: claims.sandboxRecordId,
    repoId: call.repo_id,
    teamId: typeof teamId === "string" ? teamId : null,
    conversationId: call.conversation_id,
  };
}

/**
 * The native agent's tool set for one harness run, minus what the harness
 * runs itself: its local tools and the MCP connections in its mcp.json.
 */
export async function buildHarnessMogplexTools(
  run: HarnessToolRun,
  capabilities: ReadonlySet<Capability>,
  overrides: Partial<typeof defaultDeps> = {}
): Promise<{ tools: Record<string, Tool>; cleanup: () => Promise<void> }> {
  const deps = { ...defaultDeps, ...overrides };
  const row = await deps.loadSandboxRepo(run);
  const repo = Array.isArray(row?.repo) ? row?.repo[0] : row?.repo;
  const [repoOwner, repoName] = repo?.full_name?.split("/") ?? [];
  const built = await deps.buildTools({
    userId: run.userId,
    repoId: run.repoId ?? undefined,
    sandboxId: run.sandboxRecordId,
    repoOwner,
    repoName,
    repoBranch: row?.working_branch ?? undefined,
    repoBaseBranch: row?.base_branch ?? undefined,
    conversationId: run.conversationId,
    aiCallId: run.aiCallId,
    teamId: run.teamId,
    capabilities,
    skipMcpServerConnections: true,
  });
  const tools: Record<string, Tool> = {};
  for (const [name, tool] of Object.entries(built.tools)) {
    if (!HARNESS_LOCAL_TOOLS.has(name)) tools[name] = tool;
  }
  return { tools, cleanup: built.cleanup };
}
