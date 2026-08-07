import { cloneFlowGraph } from "@/lib/flows/graph";
import {
  findPreconfiguredAgentTemplate,
  resolveAgentTemplateFork,
} from "@/lib/agents/template-forks";
import { FlowServiceError } from "@/lib/flows/errors";
import { resolveStoredUserDefaultModelId } from "@/lib/models/default-model";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { FlowGraph } from "@/lib/types";
import type { FlowPresetAgentResolverDeps } from "./server-types";

const PRESET_AGENT_ID_PREFIX = "preset:";

// Structural UUID allowlist. Version nibble [1-9a-f] admits v1 through vf.
// UUID v4 (Supabase default, nibble `4`) always passes. The variant nibble
// [89ab] covers the RFC 4122 variant; the /i flag makes this also accept
// uppercase [89AB], which is harmless — Supabase normalises UUID casing.
// Supabase's uuid column type remains the authoritative semantic validator;
// this regex only guards against obviously malformed strings reaching the
// .in() query before Supabase can produce a cryptic postgres error.
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const defaultFlowPresetAgentResolverDeps: FlowPresetAgentResolverDeps = {
  async resolveTemplateAgentFork(userId, template, teamId) {
    try {
      // New forks are stamped with the user's current default model instead of
      // the template's static constant (freeze-on-fork: existing forks are
      // untouched). Resolution failures must propagate: forks are immutable,
      // so a silent fallback here would permanently persist the stale template
      // model on a transient catalog/profile read failure. The catch below
      // converts the failure into a retryable FlowServiceError. A null result
      // (no usable models in scope) passes through as "no override" — the
      // fork keeps the template model.
      const modelOverride = await resolveStoredUserDefaultModelId(userId, {
        teamId,
      });
      return await resolveAgentTemplateFork(userId, template, {
        modelOverride,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to resolve agent template";
      throw new FlowServiceError("FLOW_STORAGE_FAILED", message, {
        cause: error,
      });
    }
  },
};

export async function assertOwnedFlowGraphAgents(
  userId: string,
  graph: FlowGraph
) {
  const agentIds = Array.from(
    new Set(
      graph.nodes
        .filter((node) => node.type === "agent")
        .map((node) =>
          typeof node.data.agentId === "string" ? node.data.agentId : null
        )
        .filter(Boolean) as string[]
    )
  );

  if (agentIds.length === 0) {
    return;
  }

  const invalidAgentId = agentIds.find(
    (agentId) => !UUID_PATTERN.test(agentId)
  );
  if (invalidAgentId) {
    // Do not echo the malformed ID in the message — it may contain preset:
    // prefixes or other internal naming conventions that should not be
    // reflected in API responses. Preserve it in cause for server-side
    // observability only, consistent with the rest of this PR's error discipline.
    throw new FlowServiceError(
      "FLOW_AGENT_FORBIDDEN",
      "One or more agents are not available to this user.",
      { cause: new Error(`Malformed agent ID rejected: "${invalidAgentId}"`) }
    );
  }

  const { data, error } = await supabaseAdmin
    .from("agents")
    .select("id")
    .eq("user_id", userId)
    .in("id", agentIds);

  if (error) {
    throw new FlowServiceError(
      "FLOW_AGENT_FORBIDDEN",
      `Failed to verify flow agents: ${error.message}`,
      {
        cause: error,
      }
    );
  }

  const ownedIds = new Set((data || []).map((agent) => agent.id as string));
  const missing = agentIds.find((agentId) => !ownedIds.has(agentId));
  if (missing) {
    // Do not echo the agent ID — ownership verification results should not
    // be reflected in API responses. Preserve it in cause for server-side
    // observability only.
    throw new FlowServiceError(
      "FLOW_AGENT_FORBIDDEN",
      "One or more agents are not available to this user.",
      { cause: new Error(`Agent not owned by user: "${missing}"`) }
    );
  }
}

export async function resolveFlowGraphPresetAgents(
  userId: string,
  graph: FlowGraph,
  deps: FlowPresetAgentResolverDeps = defaultFlowPresetAgentResolverDeps,
  // Verified active-team scope from the request header. Trails the deps param
  // so existing test callers that pass deps positionally keep working; null
  // (the default) resolves in personal scope, matching key-scoped v1 callers
  // that have no team header.
  teamId: string | null = null
) {
  const nextGraph = cloneFlowGraph(graph);
  const resolvedPresetIds = new Map<string, string>();

  for (const node of nextGraph.nodes) {
    if (node.type !== "agent") continue;
    const agentId =
      typeof node.data.agentId === "string" ? node.data.agentId.trim() : "";
    if (!agentId.startsWith(PRESET_AGENT_ID_PREFIX)) continue;

    const cachedAgentId = resolvedPresetIds.get(agentId);
    if (cachedAgentId) {
      node.data = { ...node.data, agentId: cachedAgentId };
      continue;
    }

    const templateName = agentId.slice(PRESET_AGENT_ID_PREFIX.length);
    const template = findPreconfiguredAgentTemplate(templateName);
    if (!template) {
      // Do not echo the template name back to the caller — it would reveal
      // which internal template names are recognised vs. unknown. Log the
      // specific name server-side via the cause for debugging.
      throw new FlowServiceError(
        "FLOW_AGENT_FORBIDDEN",
        "One or more agents are not available to this user.",
        { cause: new Error(`Unknown agent template: "${templateName}"`) }
      );
    }

    const resolvedAgent = await deps.resolveTemplateAgentFork(
      userId,
      template,
      teamId
    );
    if (!resolvedAgent) {
      // Generic message to the caller; the template name is preserved in the
      // cause for server-side observability without leaking it externally.
      throw new FlowServiceError(
        "FLOW_STORAGE_FAILED",
        "One or more agents could not be provisioned. Please try again.",
        { cause: new Error(`Failed to fork agent template: "${templateName}"`) }
      );
    }

    resolvedPresetIds.set(agentId, resolvedAgent.id);
    node.data = { ...node.data, agentId: resolvedAgent.id };
  }

  return nextGraph;
}
