import { validateFlowGraph, getStartConfig } from "./graph";
import { assertOwnedFlowGraphAgents } from "./server-preset-agents";
import { findPreconfiguredAgentTemplate } from "@/lib/agents/template-forks";
import {
  listUsableModelIdsForScope,
  resolveStoredUserDefaultModelId,
} from "@/lib/models/default-model";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isFlowServiceError } from "./errors";
import type { FlowGraph } from "@/lib/types";

export type FlowConfigurationValidation = { valid: boolean; errors: string[] };

// Shared by MCP preflight and publishing. This function must remain read-only:
// preset agents are checked here and provisioned only when the draft is saved.
export async function validateFlowConfiguration(
  userId: string,
  graph: FlowGraph,
  installationId: number,
  teamId: string | null = null
): Promise<FlowConfigurationValidation> {
  const validation = validateFlowGraph(graph);
  if (!validation.valid) return validation;
  const errors: string[] = [];
  const { data: installation, error: installationError } = await supabaseAdmin
    .from("github_installations")
    .select("id")
    .eq("user_id", userId)
    .eq("installation_id", installationId)
    .maybeSingle();
  if (installationError) throw new Error(installationError.message);
  if (!installation)
    return {
      valid: false,
      errors: ["Installation is not available to this user."],
    };

  const start = getStartConfig(graph)!;
  if (
    ["schedule", "webhook", "slack_mention"].includes(start.event) &&
    start.filter?.installationIds?.some((id) => id !== installationId)
  ) {
    errors.push("The trigger installationIds must match installationId.");
  }
  if (start.filter?.repos?.length) {
    let query = supabaseAdmin
      .from("repos")
      .select("full_name")
      .eq("user_id", userId)
      .in("full_name", start.filter.repos);
    // GitHub event flows may span several installations. External triggers
    // bind one repository to the selected installation.
    if (["schedule", "webhook", "slack_mention"].includes(start.event)) {
      query = query.eq("github_installation_id", installationId);
    } else if (start.filter.installationIds?.length) {
      query = query.in("github_installation_id", start.filter.installationIds);
    }
    const { data: repos, error } = await query;
    if (error) throw new Error(error.message);
    const available = new Set((repos ?? []).map((repo) => repo.full_name));
    if (start.filter.repos.some((repo) => !available.has(repo))) {
      errors.push(
        "One or more trigger repositories are not available in this installation. Use full_name from mogplex_list_repos."
      );
    }
  }

  const ownedGraph: FlowGraph = { ...graph, nodes: [] };
  const modelIds = new Set<string>();
  let needsDefaultModel = false;
  for (const node of graph.nodes) {
    if (node.type !== "agent") continue;
    const agentId = node.data.agentId;
    if (agentId?.startsWith("preset:")) {
      if (!findPreconfiguredAgentTemplate(agentId.slice("preset:".length))) {
        errors.push(
          `Agent "${node.data.label}" is not available. Choose an ID from mogplex_list_agents.`
        );
      }
    } else {
      ownedGraph.nodes.push(node);
    }
    if ((node.data.harness ?? "mogplex") === "mogplex") {
      const override = node.data.modelOverride?.trim();
      if (override) modelIds.add(override);
      else needsDefaultModel = true;
      if (node.data.fallbackModelOverride)
        modelIds.add(node.data.fallbackModelOverride);
    }
  }
  try {
    await assertOwnedFlowGraphAgents(userId, ownedGraph);
  } catch (error) {
    if (!isFlowServiceError(error)) throw error;
    errors.push(
      "Could not verify one or more agents. Choose an ID from mogplex_list_agents and try again."
    );
  }
  if (modelIds.size > 0) {
    const availableModels = new Set(
      await listUsableModelIdsForScope(userId, { surface: "agents", teamId })
    );
    for (const id of modelIds) {
      if (!availableModels.has(id))
        errors.push(
          `Model "${id}" is not enabled and available. Choose an ID from mogplex_list_models.`
        );
    }
  }
  if (
    needsDefaultModel &&
    !(await resolveStoredUserDefaultModelId(userId, {
      surface: "agents",
      teamId,
    }))
  ) {
    errors.push(
      "No enabled model is available. Enable a model in settings before publishing."
    );
  }
  return { valid: errors.length === 0, errors };
}
