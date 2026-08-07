import { randomUUID } from "node:crypto";
import { FlowServiceError } from "@/lib/flows/errors";
import {
  coerceGraph,
  createDefaultFlowGraph,
  getStartConfig,
  validateFlowGraph,
} from "@/lib/flows/graph";
import {
  bindFlowGraphToScope,
  buildFlowStarterTemplateGraph,
  flowTemplateRequiresRepository,
  getFlowStarterTemplate,
  preparePersonalFlowTemplateGraphForValidation,
  type FlowStarterTemplateId,
} from "@/lib/flows/templates";
import type { FlowGraph } from "@/lib/types";
import { consumeFault, getState } from "./test-store-state";
import {
  deepClone,
  nowIso,
  type TestFlowRow,
  type TestFlowVersionRow,
} from "./test-store-types";
import {
  assertOwnedAgents,
  assertOwnedInstallation,
  loadOwnedFlowRow,
  repairFlowPublicationConsistency,
  requireOwnedFlowRow,
  serializeFlow,
} from "./test-store-helpers";

export async function loadOwnedFlow(userId: string, flowId: string) {
  const row = loadOwnedFlowRow(userId, flowId);
  return row ? serializeFlow(repairFlowPublicationConsistency(row)) : null;
}

export async function loadOwnedInstallation(
  userId: string,
  installationId: number
) {
  return (
    getState().installations.find(
      (installation) =>
        installation.user_id === userId &&
        installation.installation_id === installationId
    ) ?? null
  );
}

export async function buildDefaultFlowDraft(input: {
  userId: string;
  installationId: number;
  name?: string | null;
  templateId?: FlowStarterTemplateId | null;
  personalTemplateId?: string | null;
  teamTemplateId?: string | null;
  teamId?: string | null;
  repository?: string | null;
}) {
  assertOwnedInstallation(input.userId, input.installationId);
  const agent =
    getState().agents.find((candidate) => candidate.user_id === input.userId) ??
    null;
  const personalTemplate = input.personalTemplateId
    ? (getState().flowTemplates.find(
        (candidate) =>
          candidate.id === input.personalTemplateId &&
          (candidate.owner_type ?? "user") === "user" &&
          (candidate.owner_user_id ?? candidate.user_id) === input.userId
      ) ?? null)
    : null;
  const teamTemplate =
    input.teamTemplateId && input.teamId
      ? (getState().flowTemplates.find(
          (candidate) =>
            candidate.id === input.teamTemplateId &&
            (candidate.owner_type ?? "user") === "team" &&
            candidate.product_team_id === input.teamId
        ) ?? null)
      : null;
  if (input.personalTemplateId && !personalTemplate) {
    throw new FlowServiceError("FLOW_NOT_FOUND", "Workflow template not found");
  }
  if (input.teamTemplateId && !teamTemplate) {
    throw new FlowServiceError("FLOW_NOT_FOUND", "Workflow template not found");
  }
  const storedTemplate = personalTemplate ?? teamTemplate;

  const template = input.templateId
    ? getFlowStarterTemplate(input.templateId)
    : null;
  if (
    storedTemplate &&
    flowTemplateRequiresRepository(storedTemplate.graph) &&
    !input.repository?.trim()
  ) {
    throw new FlowServiceError(
      "FLOW_GRAPH_INVALID",
      "This workflow template requires a repository."
    );
  }
  const draftGraph = bindFlowGraphToScope(
    storedTemplate
      ? storedTemplate.graph
      : input.templateId
        ? buildFlowStarterTemplateGraph({
            templateId: input.templateId,
            agentId: agent?.id ?? null,
            agentName: agent?.name ?? "Agent",
          })
        : createDefaultFlowGraph({
            agentId: agent?.id ?? null,
            agentName: agent?.name ?? "Agent",
          }),
    {
      installationId: input.installationId,
      repository: input.repository,
    }
  );
  const validation = validateFlowGraph(
    storedTemplate
      ? preparePersonalFlowTemplateGraphForValidation(draftGraph)
      : draftGraph,
    { requireRunnableConfig: Boolean(personalTemplate) }
  );
  if (!validation.valid) {
    throw new FlowServiceError(
      "FLOW_GRAPH_INVALID",
      validation.errors[0] || "Workflow template is invalid",
      { details: validation.errors }
    );
  }
  assertOwnedAgents(input.userId, draftGraph);

  return {
    name:
      input.name?.trim() ||
      storedTemplate?.name ||
      template?.name ||
      "Untitled flow",
    description: storedTemplate?.description ?? template?.description ?? null,
    draftGraph,
  };
}

export async function createFlowForUser(input: {
  userId: string;
  installationId: number;
  name?: string | null;
  templateId?: FlowStarterTemplateId | null;
  personalTemplateId?: string | null;
  teamTemplateId?: string | null;
  teamId?: string | null;
  repository?: string | null;
}) {
  const draft = await buildDefaultFlowDraft(input);
  const createdAt = nowIso();
  const row: TestFlowRow = {
    id: randomUUID(),
    user_id: input.userId,
    installation_id: input.installationId,
    name: draft.name,
    description: draft.description,
    notes: null,
    source_kind: "github",
    status: "inactive",
    draft_graph: draft.draftGraph,
    published_version_id: null,
    created_at: createdAt,
    updated_at: createdAt,
  };

  getState().flows.push(row);
  return serializeFlow(row);
}

export async function updateFlow(input: {
  userId: string;
  flowId: string;
  name?: string;
  description?: string | null;
  notes?: string | null;
  installationId?: number;
  draftGraph?: FlowGraph;
}) {
  const flow = requireOwnedFlowRow(input.userId, input.flowId);

  if (
    input.installationId !== undefined &&
    (!Number.isFinite(input.installationId) || input.installationId <= 0)
  ) {
    throw new FlowServiceError(
      "FLOW_INVALID_INSTALLATION_ID",
      "Invalid installation_id"
    );
  }

  if (typeof input.installationId === "number") {
    assertOwnedInstallation(input.userId, input.installationId);
  }
  if (input.draftGraph) {
    assertOwnedAgents(input.userId, input.draftGraph);
  }

  if (typeof input.name === "string" && input.name.trim()) {
    flow.name = input.name.trim();
  }
  if (input.description !== undefined) {
    flow.description = input.description;
  }
  if (input.notes !== undefined) {
    flow.notes = input.notes;
  }
  if (typeof input.installationId === "number") {
    flow.installation_id = input.installationId;
  }
  if (input.draftGraph) {
    flow.draft_graph = input.draftGraph;
  }
  flow.updated_at = nowIso();

  return serializeFlow(flow);
}

export async function syncFlowActivation(
  userId: string,
  flowId: string,
  status: "active" | "inactive"
) {
  const flow = requireOwnedFlowRow(userId, flowId);
  if (status === "active" && !flow.published_version_id) {
    throw new FlowServiceError(
      "FLOW_UNPUBLISHED_ACTIVATION",
      "A flow must be published before it can be activated."
    );
  }

  flow.status = status;
  flow.updated_at = nowIso();

  return serializeFlow(flow);
}

export async function publishFlowDraft(userId: string, flowId: string) {
  const flow = requireOwnedFlowRow(userId, flowId);
  const graph = coerceGraph(flow.draft_graph);
  const validation = validateFlowGraph(graph);
  if (!validation.valid) {
    throw new FlowServiceError(
      "FLOW_GRAPH_INVALID",
      validation.errors[0] || "Flow graph is invalid",
      {
        details: validation.errors,
      }
    );
  }

  assertOwnedAgents(userId, graph);
  const startConfig = getStartConfig(graph);
  if (!startConfig) {
    throw new FlowServiceError(
      "FLOW_GRAPH_INVALID",
      "Flow start configuration is missing."
    );
  }
  const scopedInstallationIds = startConfig.filter?.installationIds ?? [];
  const publishedInstallationId =
    scopedInstallationIds.length === 1
      ? scopedInstallationIds[0]
      : flow.installation_id;
  if (
    !Number.isFinite(publishedInstallationId) ||
    publishedInstallationId <= 0
  ) {
    throw new FlowServiceError(
      "FLOW_INVALID_INSTALLATION_ID",
      "Invalid installation_id"
    );
  }
  if (publishedInstallationId !== flow.installation_id) {
    assertOwnedInstallation(userId, publishedInstallationId);
  }

  const state = getState();
  const latestVersionNumber = state.flowVersions
    .filter((version) => version.flow_id === flow.id)
    .reduce((max, version) => Math.max(max, version.version_number), 0);

  const version: TestFlowVersionRow = {
    id: randomUUID(),
    flow_id: flow.id,
    version_number: latestVersionNumber + 1,
    graph,
    created_at: nowIso(),
  };

  state.flowVersions.push(version);
  flow.installation_id = publishedInstallationId;
  flow.published_version_id = version.id;
  flow.status = "active";
  flow.updated_at = nowIso();

  return serializeFlow(flow);
}

export async function duplicateFlow(userId: string, flowId: string) {
  const flow = requireOwnedFlowRow(userId, flowId);
  const createdAt = nowIso();
  const duplicate: TestFlowRow = {
    id: randomUUID(),
    user_id: userId,
    installation_id: flow.installation_id,
    name: `${flow.name} Copy`,
    description: flow.description,
    notes: flow.notes,
    source_kind: flow.source_kind,
    status: "inactive",
    draft_graph: deepClone(flow.draft_graph),
    published_version_id: null,
    created_at: createdAt,
    updated_at: createdAt,
  };

  getState().flows.push(duplicate);
  return serializeFlow(duplicate);
}

export async function deleteFlow(userId: string, flowId: string) {
  const flow = requireOwnedFlowRow(userId, flowId);
  const state = getState();
  const flowFailure = consumeFault("failNextFlowDelete");

  if (flowFailure) {
    throw new FlowServiceError("FLOW_DELETE_SYNC_FAILED", flowFailure);
  }

  state.flows = state.flows.filter((candidate) => candidate.id !== flow.id);
  state.flowVersions = state.flowVersions.filter(
    (version) => version.flow_id !== flow.id
  );
  state.jobRuns = state.jobRuns.map((jobRun) =>
    jobRun.flow_id === flow.id ? { ...jobRun, flow_id: null } : jobRun
  );
  return { ok: true };
}
