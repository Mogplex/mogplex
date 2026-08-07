import { randomUUID } from "node:crypto";
import { FlowServiceError } from "@/lib/flows/errors";
import { validateFlowGraph, getStartConfig } from "@/lib/flows/graph";
import {
  flowTemplateRequiresRepository,
  getFlowTemplateReconnects,
  preparePersonalFlowTemplateGraphForValidation,
  sanitizeFlowGraphForPersonalTemplate,
  sanitizeFlowGraphForTeamTemplate,
} from "@/lib/flows/templates";
import type { ProductResourceScope } from "@/lib/team-resource-scope";
import { getState } from "./test-store-state";
import { nowIso, type TestPersonalFlowTemplateRow } from "./test-store-types";
import {
  assertOwnedAgents,
  requireOwnedFlowRow,
  serializePersonalFlowTemplate,
  summarizePersonalFlowTemplate,
} from "./test-store-helpers";

const PERSONAL_FLOW_TEMPLATE_PAGE_SIZE = 25;

function testTemplateMatchesScope(
  template: TestPersonalFlowTemplateRow,
  scope: ProductResourceScope
) {
  const ownerType = template.owner_type ?? "user";
  return scope.kind === "team"
    ? ownerType === "team" && template.product_team_id === scope.productTeamId
    : ownerType === "user" &&
        (template.owner_user_id ?? template.user_id) === scope.userId;
}

export async function listFlowTemplates(
  scope: ProductResourceScope,
  cursor = 0
) {
  const rows = getState()
    .flowTemplates.filter((template) =>
      testTemplateMatchesScope(template, scope)
    )
    .sort(
      (left, right) =>
        right.updated_at.localeCompare(left.updated_at) ||
        right.id.localeCompare(left.id)
    )
    .slice(cursor, cursor + PERSONAL_FLOW_TEMPLATE_PAGE_SIZE + 1);
  const hasNextPage = rows.length > PERSONAL_FLOW_TEMPLATE_PAGE_SIZE;
  return {
    templates: rows
      .slice(0, PERSONAL_FLOW_TEMPLATE_PAGE_SIZE)
      .map(serializePersonalFlowTemplate)
      .map(summarizePersonalFlowTemplate),
    next_cursor: hasNextPage
      ? String(cursor + PERSONAL_FLOW_TEMPLATE_PAGE_SIZE)
      : null,
  };
}

export async function createFlowTemplate(input: {
  userId: string;
  flowId: string;
  name?: string | null;
  scope: ProductResourceScope;
}) {
  const flow = requireOwnedFlowRow(input.userId, input.flowId);
  const validation = validateFlowGraph(flow.draft_graph);
  if (!validation.valid) {
    throw new FlowServiceError(
      "FLOW_GRAPH_INVALID",
      validation.errors[0] || "Flow graph is invalid",
      { details: validation.errors }
    );
  }
  assertOwnedAgents(input.userId, flow.draft_graph);

  const graph =
    input.scope.kind === "team"
      ? sanitizeFlowGraphForTeamTemplate(flow.draft_graph)
      : sanitizeFlowGraphForPersonalTemplate(flow.draft_graph);
  const triggerEvent = getStartConfig(graph)?.event ?? "mention";
  const reconnect = getFlowTemplateReconnects(graph);
  const requiresRepository = flowTemplateRequiresRepository(graph);
  const templateValidation = validateFlowGraph(
    preparePersonalFlowTemplateGraphForValidation(graph),
    { requireRunnableConfig: input.scope.kind !== "team" }
  );
  if (!templateValidation.valid) {
    throw new FlowServiceError(
      "FLOW_GRAPH_INVALID",
      templateValidation.errors[0] || "Workflow template is invalid",
      { details: templateValidation.errors }
    );
  }

  const createdAt = nowIso();
  const template: TestPersonalFlowTemplateRow = {
    id: randomUUID(),
    user_id: input.userId,
    owner_type: input.scope.kind === "team" ? "team" : "user",
    owner_user_id: input.scope.kind === "team" ? null : input.scope.userId,
    product_team_id: input.scope.productTeamId,
    created_by_user_id: input.userId,
    name: input.name?.trim() || flow.name,
    description: flow.description,
    graph,
    source_flow_id: input.scope.kind === "team" ? null : flow.id,
    trigger_event: triggerEvent,
    reconnect,
    requires_repository: requiresRepository,
    created_at: createdAt,
    updated_at: createdAt,
  };
  getState().flowTemplates.push(template);
  return summarizePersonalFlowTemplate(serializePersonalFlowTemplate(template));
}

export async function listOwnedPersonalFlowTemplates(
  userId: string,
  cursor = 0
) {
  return listFlowTemplates(
    {
      kind: "personal",
      userId,
      productTeamId: null,
    },
    cursor
  );
}

export async function createPersonalFlowTemplate(input: {
  userId: string;
  flowId: string;
  name?: string | null;
}) {
  return createFlowTemplate({
    ...input,
    scope: {
      kind: "personal",
      userId: input.userId,
      productTeamId: null,
    },
  });
}

export async function deleteFlowTemplate(
  scope: ProductResourceScope,
  templateId: string
) {
  const state = getState();
  const before = state.flowTemplates.length;
  state.flowTemplates = state.flowTemplates.filter(
    (template) =>
      template.id !== templateId || !testTemplateMatchesScope(template, scope)
  );
  return state.flowTemplates.length < before;
}
