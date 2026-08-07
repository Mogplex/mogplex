import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  coerceGraph,
  getPrimaryAgentId,
  getStartConfig,
} from "@/lib/flows/graph";

type RepoRef = {
  id: string;
  full_name: string;
  user_id: string;
  github_installation_id: number | null;
};

type AssignmentRef = {
  id: string;
  repo_id: string;
  agent_id: string;
  type: string;
};

type TriggerRef = {
  id: string;
  agent_id: string;
  installation_id: number;
  event: string;
};

type FlowRef = {
  id: string;
  installation_id: number;
  name: string;
  published_version_id: string | null;
};

type FlowVersionRef = {
  id: string;
  flow_id: string;
  graph: unknown;
};

export type FlowVersionAttribution = {
  flowId: string;
  primaryAgentId: string | null;
  agentIds: string[];
  sourceType: string | null;
};

type AgentRef = {
  id: string;
  name: string;
  slug: string | null;
  model: string;
};

export type UserAutomationScope = {
  reposById: Map<string, RepoRef>;
  assignmentsById: Map<string, AssignmentRef>;
  triggersById: Map<string, TriggerRef>;
  flowsById: Map<string, FlowRef>;
  agentsById: Map<string, AgentRef>;
  flowAttributionByVersionId: Map<string, FlowVersionAttribution>;
  currentFlowVersionIdByFlowId: Map<string, string>;
  assignmentIds: string[];
  triggerIds: string[];
  flowIds: string[];
};

export type UserAutomationEntities = {
  repos: RepoRef[];
  assignments: AssignmentRef[];
  triggers: TriggerRef[];
  flows: FlowRef[];
};

export function createEmptyUserAutomationScope(): UserAutomationScope {
  return {
    reposById: new Map(),
    assignmentsById: new Map(),
    triggersById: new Map(),
    flowsById: new Map(),
    agentsById: new Map(),
    flowAttributionByVersionId: new Map(),
    currentFlowVersionIdByFlowId: new Map(),
    assignmentIds: [],
    triggerIds: [],
    flowIds: [],
  };
}

export function getMetadataFlowVersionId(
  metadata: Record<string, unknown> | null | undefined
) {
  return typeof metadata?.flow_version_id === "string" &&
    metadata.flow_version_id.length > 0
    ? metadata.flow_version_id
    : null;
}

function buildFlowVersionAttribution(
  version: FlowVersionRef
): FlowVersionAttribution {
  const graph = coerceGraph(version.graph);
  const primaryAgentId = getPrimaryAgentId(graph);
  const agentIds = Array.from(
    new Set(
      graph.nodes
        .filter((node) => node.type === "agent")
        .map((node) => node.data.agentId)
        .filter(
          (agentId): agentId is string =>
            typeof agentId === "string" && agentId.length > 0
        )
    )
  );
  const startConfig = getStartConfig(graph);

  return {
    flowId: version.flow_id,
    primaryAgentId,
    agentIds,
    sourceType: startConfig?.event ?? null,
  };
}

export async function loadUserAutomationEntities(
  userId: string
): Promise<UserAutomationEntities> {
  const { data: repos, error: reposError } = await supabaseAdmin
    .from("repos")
    .select("id, full_name, user_id, github_installation_id")
    .eq("user_id", userId);

  if (reposError) {
    throw new Error(`Failed to load repos: ${reposError.message}`);
  }

  const repoRows = repos || [];
  const repoIds = repoRows.map((repo) => repo.id);

  const [assignmentsResult, triggersResult, flowsResult] = await Promise.all([
    repoIds.length > 0
      ? supabaseAdmin
          .from("assignments")
          .select("id, repo_id, agent_id, type")
          .in("repo_id", repoIds)
      : Promise.resolve({ data: [], error: null }),
    supabaseAdmin
      .from("triggers")
      .select("id, agent_id, installation_id, event")
      .eq("user_id", userId),
    supabaseAdmin
      .from("flows")
      .select("id, installation_id, name, published_version_id")
      .eq("user_id", userId),
  ]);

  if (assignmentsResult.error) {
    throw new Error(
      `Failed to load assignments: ${assignmentsResult.error.message}`
    );
  }

  if (triggersResult.error) {
    throw new Error(`Failed to load triggers: ${triggersResult.error.message}`);
  }

  if (flowsResult.error) {
    throw new Error(`Failed to load flows: ${flowsResult.error.message}`);
  }

  return {
    repos: repoRows,
    assignments: assignmentsResult.data || [],
    triggers: triggersResult.data || [],
    flows: flowsResult.data || [],
  };
}

export async function buildUserAutomationScope(
  entities: UserAutomationEntities,
  options?: {
    flowVersionIds?: string[];
  }
): Promise<UserAutomationScope> {
  const publishedVersionIds = entities.flows
    .map((flow) => flow.published_version_id)
    .filter(
      (value): value is string => typeof value === "string" && value.length > 0
    );
  const versionIds = Array.from(
    new Set([
      ...publishedVersionIds,
      ...(options?.flowVersionIds || []).filter(
        (value): value is string =>
          typeof value === "string" && value.length > 0
      ),
    ])
  );
  const { data: flowVersions, error: flowVersionsError } =
    versionIds.length > 0
      ? await supabaseAdmin
          .from("flow_versions")
          .select("id, flow_id, graph")
          .in("id", versionIds)
      : { data: [], error: null };

  if (flowVersionsError) {
    throw new Error(
      `Failed to load flow versions: ${flowVersionsError.message}`
    );
  }

  const flowAttributionByVersionId = new Map<string, FlowVersionAttribution>();
  for (const version of (flowVersions || []) as FlowVersionRef[]) {
    flowAttributionByVersionId.set(
      version.id,
      buildFlowVersionAttribution(version)
    );
  }

  const currentFlowVersionIdByFlowId = new Map<string, string>();
  for (const flow of entities.flows) {
    if (
      typeof flow.published_version_id === "string" &&
      flow.published_version_id.length > 0
    ) {
      currentFlowVersionIdByFlowId.set(flow.id, flow.published_version_id);
    }
  }

  const agentIds = Array.from(
    new Set([
      ...entities.assignments.map((assignment) => assignment.agent_id),
      ...entities.triggers.map((trigger) => trigger.agent_id),
      ...Array.from(flowAttributionByVersionId.values()).flatMap(
        (entry) => entry.agentIds
      ),
    ])
  );

  const { data: agents, error: agentsError } =
    agentIds.length > 0
      ? await supabaseAdmin
          .from("agents")
          .select("id, name, slug, model")
          .in("id", agentIds)
      : { data: [], error: null };

  if (agentsError) {
    throw new Error(`Failed to load agents: ${agentsError.message}`);
  }

  return {
    reposById: new Map(entities.repos.map((repo) => [repo.id, repo])),
    assignmentsById: new Map(
      entities.assignments.map((assignment) => [assignment.id, assignment])
    ),
    triggersById: new Map(
      entities.triggers.map((trigger) => [trigger.id, trigger])
    ),
    flowsById: new Map(entities.flows.map((flow) => [flow.id, flow])),
    agentsById: new Map((agents || []).map((agent) => [agent.id, agent])),
    flowAttributionByVersionId,
    currentFlowVersionIdByFlowId,
    assignmentIds: entities.assignments.map((assignment) => assignment.id),
    triggerIds: entities.triggers.map((trigger) => trigger.id),
    flowIds: entities.flows.map((flow) => flow.id),
  };
}

export async function loadUserAutomationScope(
  userId: string,
  options?: {
    flowVersionIds?: string[];
  }
): Promise<UserAutomationScope> {
  const entities = await loadUserAutomationEntities(userId);
  return buildUserAutomationScope(entities, options);
}

export function resolveFlowVersionAttribution(
  scope: Pick<
    UserAutomationScope,
    "flowAttributionByVersionId" | "currentFlowVersionIdByFlowId"
  >,
  input: {
    flowId?: string | null;
    flowVersionId?: string | null;
    metadata?: Record<string, unknown> | null;
  }
) {
  const candidateVersionIds = [
    input.flowVersionId,
    getMetadataFlowVersionId(input.metadata),
    input.flowId
      ? (scope.currentFlowVersionIdByFlowId.get(input.flowId) ?? null)
      : null,
  ];

  for (const versionId of candidateVersionIds) {
    if (!versionId) continue;
    const attribution = scope.flowAttributionByVersionId.get(versionId);
    if (attribution) {
      return attribution;
    }
  }

  return null;
}
