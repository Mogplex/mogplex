import { supabaseAdmin } from "@/lib/supabase/admin";
import { coerceGraph, getStartConfig } from "@/lib/flows/graph";
import type { FlowNode } from "@/lib/types";
import { normalizeAutomationAssignmentType } from "@/lib/workflows/automation-job-utils";
import { resolveJobRunRuntimeDetails } from "@/lib/workflows/automation-job-metadata";
import { startAutomationJobRun } from "@/lib/workflows/automation-job-start";
import { releaseQueuedJobs as releaseQueuedJobsBase } from "@/lib/workflows/automation-job-persistence";
import type {
  FlowAgentConfig,
  FlowExecutionToken,
  JobContext,
  ReleasedAutomationScope,
  ResolvedFlowDefinition,
  ResolvedJobContext,
} from "@/lib/workflows/automation-job-types";

export async function loadFlowDefinition(
  flowVersionId: string,
  fallbackFlowId?: string | null
): Promise<ResolvedFlowDefinition | null> {
  const { data: version, error: versionError } = await supabaseAdmin
    .from("flow_versions")
    .select("*")
    .eq("id", flowVersionId)
    .maybeSingle();

  if (versionError) {
    throw new Error(`Failed to load flow version: ${versionError.message}`);
  }
  if (!version) return null;

  const graph = coerceGraph(version.graph);
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

  const { data: agents, error: agentsError } =
    agentIds.length > 0
      ? await supabaseAdmin
          .from("agents")
          .select("id, name, slug, model, system_prompt")
          .in("id", agentIds)
      : { data: [], error: null };

  if (agentsError) {
    throw new Error(`Failed to load flow agents: ${agentsError.message}`);
  }

  return {
    flowId: fallbackFlowId || version.flow_id,
    flowVersionId: version.id,
    graph,
    agentsById: new Map(
      (agents || []).map((agent) => [
        agent.id,
        {
          id: agent.id,
          name: agent.name ?? null,
          slug: agent.slug ?? null,
          system_prompt: agent.system_prompt ?? null,
          max_steps: null,
          timeout_ms: null,
        } satisfies FlowAgentConfig,
      ])
    ),
  };
}

// The node owns the model. `agents.model` is deliberately NOT a fallback here:
// an agent is a reusable definition (prompt, role), and the model is a property
// of where that definition is *used*. Two sources of truth let the automations
// tab show one model while a run used another — see the caller, which rejects a
// node with no model rather than quietly substituting one.
export function resolveFlowAgentOverrides(
  agent: FlowAgentConfig,
  node: Extract<FlowNode, { type: "agent" }>,
  modelId: string
): JobContext["agent"] {
  return {
    id: agent.id,
    name: agent.name,
    slug: agent.slug,
    model: modelId,
    fallback_model: node.data.fallbackModelOverride ?? null,
    system_prompt: node.data.systemPromptOverride ?? agent.system_prompt,
    max_steps:
      typeof node.data.maxStepsOverride === "number"
        ? node.data.maxStepsOverride
        : agent.max_steps,
    timeout_ms:
      typeof node.data.timeoutMsOverride === "number"
        ? node.data.timeoutMsOverride
        : agent.timeout_ms,
  };
}

export function buildFlowConditionState(input: {
  context: JobContext;
  inboundTokens: FlowExecutionToken[];
  outputs: Map<string, { label: string; text: string }>;
  flowState: Map<string, unknown>;
}) {
  const outputsByNodeId = Object.fromEntries(
    Array.from(input.outputs.entries()).map(([nodeId, output]) => [
      nodeId,
      output.text,
    ])
  );
  const outputsByLabel = Object.fromEntries(
    Array.from(input.outputs.values()).map((output) => [
      output.label,
      output.text,
    ])
  );

  return {
    metadata: input.context.metadata,
    repo: {
      id: input.context.repo.id,
      full_name: input.context.repo.full_name,
      default_branch: input.context.repo.default_branch ?? null,
    },
    outputs: outputsByNodeId,
    outputs_by_label: outputsByLabel,
    previous_outputs: input.inboundTokens
      .filter((token) => !token.skipped && token.text.trim().length > 0)
      .map((token) => ({
        label: token.label,
        output: token.text,
      })),
    state: Object.fromEntries(input.flowState.entries()),
  };
}

export async function resolveJobContext(
  jobRunId: string
): Promise<ResolvedJobContext> {
  "use step";

  const { data: job, error } = await supabaseAdmin
    .from("job_runs")
    .select("*, assignments(*, agents(*), repos(*))")
    .eq("id", jobRunId)
    .single();

  if (error || !job) {
    return { error: "JOB_NOT_FOUND" as const };
  }

  const runtime = resolveJobRunRuntimeDetails(job);

  // Legacy trigger dispatch removed: it built JobContext straight from the
  // agent row, so a run took `agents.model` with no way for the automation to
  // override it — the second source of truth this refactor exists to delete.
  // Every automation now runs as a flow, where the node owns the model.
  // Fail loudly rather than silently rerouting: a trigger-dispatched job means
  // something upstream still enqueues one, and that should be visible.
  if (job.trigger_id) {
    return { error: "MISSING_CONFIG" as const };
  }

  if (job.flow_id || job.flow_version_id) {
    const metadata = (job.metadata ?? {}) as Record<string, unknown>;
    const flowId =
      typeof job.flow_id === "string"
        ? job.flow_id
        : typeof metadata.flow_id === "string"
          ? metadata.flow_id
          : null;
    const flowVersionId =
      typeof job.flow_version_id === "string"
        ? job.flow_version_id
        : typeof metadata.flow_version_id === "string"
          ? metadata.flow_version_id
          : null;

    if (!flowId || !flowVersionId) {
      return { error: "MISSING_CONFIG" as const };
    }

    const { data: flow, error: flowError } = await supabaseAdmin
      .from("flows")
      .select("id, user_id, installation_id")
      .eq("id", flowId)
      .maybeSingle();

    if (flowError) {
      throw new Error(`Failed to load flow context: ${flowError.message}`);
    }

    const resolvedFlow = await loadFlowDefinition(flowVersionId, flowId);
    if (!flow || !resolvedFlow) {
      return { error: "MISSING_CONFIG" as const };
    }

    const repoId =
      typeof metadata.repo_id === "string" ? metadata.repo_id : null;
    let repo: JobContext["repo"] | null = null;

    if (repoId) {
      const { data: repoData, error: repoError } = await supabaseAdmin
        .from("repos")
        .select("*")
        .eq("id", repoId)
        .maybeSingle();

      if (repoError) {
        throw new Error(
          `Failed to load flow repo context: ${repoError.message}`
        );
      }

      repo = repoData;
    }

    if (!repo && typeof metadata.repo_full_name === "string") {
      repo = {
        id: repoId || "",
        user_id: flow.user_id,
        full_name: metadata.repo_full_name,
        github_installation_id:
          typeof metadata.installation_id === "number"
            ? metadata.installation_id
            : flow.installation_id,
      };
    }

    // Job-level placeholder only: every agent node rebuilds `context.agent`
    // from its own node before running (see resolveFlowAgentOverrides), so this
    // never selects the model a step actually executes on. Take the model from
    // the first agent node rather than the agent row so the job-level metadata
    // agrees with what the automation is configured to run.
    const firstAgentNode = resolvedFlow.graph.nodes.find(
      (node): node is Extract<FlowNode, { type: "agent" }> =>
        node.type === "agent"
    );
    const fallbackAgentConfig =
      Array.from(resolvedFlow.agentsById.values())[0] ?? null;
    const fallbackAgent = fallbackAgentConfig
      ? {
          ...fallbackAgentConfig,
          model:
            firstAgentNode?.data.modelOverride?.trim() ||
            `harness:${firstAgentNode?.data.harness ?? "mogplex"}`,
        }
      : null;
    const assignmentType =
      typeof metadata.source_type === "string"
        ? normalizeAutomationAssignmentType(metadata.source_type)
        : (() => {
            const startConfig = getStartConfig(resolvedFlow.graph);
            return normalizeAutomationAssignmentType(
              startConfig?.event ?? "mention"
            );
          })();

    if (!repo || !fallbackAgent) {
      return { error: "MISSING_CONFIG" as const };
    }

    return {
      context: {
        metadata,
        assignmentType,
        skillId: null,
        agent: fallbackAgent,
        repo,
      } satisfies JobContext,
      flow: resolvedFlow,
      runtime,
    };
  }

  // Legacy assignment dispatch removed for the same reason as triggers above:
  // it ran `assignment.agents` verbatim, model included, with no node to
  // override it. Assignments carry no model of their own, so there is nothing
  // to migrate — a job that reaches here is unroutable, not mis-modelled.
  return { error: "MISSING_CONFIG" as const };
}

// Wrapper that binds startAutomationJobRun to the module's release function
// (the module version takes it as a parameter to avoid circular dependencies)
export async function releaseQueuedJobs(input: {
  jobRunId: string;
  releasedScope: ReleasedAutomationScope;
}) {
  return releaseQueuedJobsBase(input, startAutomationJobRun);
}
