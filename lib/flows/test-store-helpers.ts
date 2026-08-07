import { FlowServiceError } from "@/lib/flows/errors";
import type { Flow, FlowGraph, PersonalFlowTemplate } from "@/lib/types";
import { getState } from "./test-store-state";
import {
  deepClone,
  nowIso,
  type TestFlowRow,
  type TestPersonalFlowTemplateRow,
} from "./test-store-types";

export function serializeFlow(row: TestFlowRow) {
  const state = getState();
  const publishedVersion = row.published_version_id
    ? (state.flowVersions.find(
        (version) => version.id === row.published_version_id
      ) ?? null)
    : null;

  return {
    ...row,
    draft_graph: deepClone(row.draft_graph),
    published_version: publishedVersion
      ? {
          ...publishedVersion,
          graph: deepClone(publishedVersion.graph),
        }
      : null,
  } satisfies Flow;
}

export function serializePersonalFlowTemplate(
  row: TestPersonalFlowTemplateRow
): PersonalFlowTemplate & { graph: FlowGraph } {
  const ownerType = row.owner_type ?? "user";
  return {
    id: row.id,
    owner_type: ownerType,
    owner_user_id:
      row.owner_user_id ?? (ownerType === "user" ? row.user_id : null),
    product_team_id: row.product_team_id ?? null,
    created_by_user_id: row.created_by_user_id ?? row.user_id,
    name: row.name,
    description: row.description,
    graph: deepClone(row.graph),
    source_flow_id: ownerType === "team" ? null : row.source_flow_id,
    trigger_event: row.trigger_event,
    reconnect: row.reconnect,
    requires_repository: row.requires_repository,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function summarizePersonalFlowTemplate(
  template: PersonalFlowTemplate & { graph: FlowGraph }
): PersonalFlowTemplate {
  const { graph: _graph, ...summary } = template;
  return summary;
}

export function repairFlowPublicationConsistency(row: TestFlowRow) {
  if (row.status !== "active" || row.published_version_id) {
    return row;
  }

  const state = getState();
  const latestVersion =
    state.flowVersions
      .filter((version) => version.flow_id === row.id)
      .sort((a, b) => b.version_number - a.version_number)[0] ?? null;

  row.updated_at = nowIso();

  if (latestVersion) {
    row.published_version_id = latestVersion.id;
  } else {
    row.status = "inactive";
  }

  return row;
}

export function loadOwnedFlowRow(userId: string, flowId: string) {
  return (
    getState().flows.find(
      (flow) => flow.id === flowId && flow.user_id === userId
    ) ?? null
  );
}

export function requireOwnedFlowRow(userId: string, flowId: string) {
  const flow = loadOwnedFlowRow(userId, flowId);
  if (!flow) {
    throw new FlowServiceError("FLOW_NOT_FOUND", "Flow not found");
  }
  return flow;
}

export function assertOwnedInstallation(
  userId: string,
  installationId: number
) {
  const installation = getState().installations.find(
    (candidate) =>
      candidate.user_id === userId &&
      candidate.installation_id === installationId
  );

  if (!installation) {
    throw new FlowServiceError(
      "FLOW_INSTALLATION_NOT_FOUND",
      "Installation not found"
    );
  }

  return installation;
}

export function assertOwnedAgents(userId: string, graph: FlowGraph) {
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

  if (agentIds.length === 0) return;

  const ownedIds = new Set(
    getState()
      .agents.filter((agent) => agent.user_id === userId)
      .map((agent) => agent.id)
  );

  const missing = agentIds.find((agentId) => !ownedIds.has(agentId));
  if (missing) {
    throw new FlowServiceError(
      "FLOW_AGENT_FORBIDDEN",
      `Agent "${missing}" is not available to this user.`
    );
  }
}
