import {
  coerceGraph,
  validateFlowGraph,
  getStartConfig,
} from "@/lib/flows/graph";
import { FlowServiceError } from "@/lib/flows/errors";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  getFlowTemplateReconnects,
  flowTemplateRequiresRepository,
  preparePersonalFlowTemplateGraphForValidation,
  sanitizeFlowGraphForPersonalTemplate,
  sanitizeFlowGraphForTeamTemplate,
} from "@/lib/flows/templates";
import {
  applyResourceOwnerScope,
  buildResourceOwnershipInsert,
  type ProductResourceScope,
} from "@/lib/team-resource-scope";
import type {
  PersonalFlowTemplateRow,
  StoredPersonalFlowTemplate,
} from "./server-types";
import {
  serializePersonalFlowTemplateRow,
  serializePersonalFlowTemplateSummaryRow,
} from "./server-serialization";
import { assertOwnedFlowGraphAgents } from "./server-preset-agents";
import { loadOwnedFlow } from "./server-flow-ops";

const PERSONAL_FLOW_TEMPLATE_PAGE_SIZE = 25;

export async function listFlowTemplates(
  scope: ProductResourceScope,
  cursor = 0
) {
  let query = supabaseAdmin
    .from("flow_templates")
    .select(
      "id, owner_type, owner_user_id, product_team_id, created_by_user_id, name, description, source_flow_id, trigger_event, reconnect, requires_repository, created_at, updated_at"
    )
    .order("updated_at", { ascending: false })
    .order("id", { ascending: false });
  query = applyResourceOwnerScope(query, scope);
  const { data, error } = await query.range(
    cursor,
    cursor + PERSONAL_FLOW_TEMPLATE_PAGE_SIZE
  );

  if (error) {
    throw new FlowServiceError(
      "FLOW_STORAGE_FAILED",
      `Failed to load workflow templates: ${error.message}`,
      { cause: error }
    );
  }

  const rows =
    (data as Array<
      Omit<PersonalFlowTemplateRow, "graph" | "user_id">
    > | null) ?? [];
  const hasNextPage = rows.length > PERSONAL_FLOW_TEMPLATE_PAGE_SIZE;
  return {
    templates: rows
      .slice(0, PERSONAL_FLOW_TEMPLATE_PAGE_SIZE)
      .map(serializePersonalFlowTemplateSummaryRow),
    next_cursor: hasNextPage
      ? String(cursor + PERSONAL_FLOW_TEMPLATE_PAGE_SIZE)
      : null,
  };
}

export async function loadOwnedPersonalFlowTemplate(
  userId: string,
  templateId: string
) {
  return loadFlowTemplate(
    {
      kind: "personal",
      userId,
      productTeamId: null,
    },
    templateId
  );
}

export async function loadFlowTemplate(
  scope: ProductResourceScope,
  templateId: string
): Promise<StoredPersonalFlowTemplate | null> {
  let query = supabaseAdmin
    .from("flow_templates")
    .select("*")
    .eq("id", templateId);
  query = applyResourceOwnerScope(query, scope);
  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new FlowServiceError(
      "FLOW_STORAGE_FAILED",
      `Failed to load workflow template: ${error.message}`,
      { cause: error }
    );
  }

  return data
    ? serializePersonalFlowTemplateRow(data as PersonalFlowTemplateRow)
    : null;
}

export async function createFlowTemplate(input: {
  userId: string;
  flowId: string;
  name?: string | null;
  scope: ProductResourceScope;
}) {
  const flow = await loadOwnedFlow(input.userId, input.flowId);
  if (!flow) {
    throw new FlowServiceError("FLOW_NOT_FOUND", "Flow not found");
  }

  const graph = coerceGraph(flow.draft_graph);
  const validation = validateFlowGraph(graph);
  if (!validation.valid) {
    throw new FlowServiceError(
      "FLOW_GRAPH_INVALID",
      validation.errors[0] || "Flow graph is invalid",
      { details: validation.errors }
    );
  }
  await assertOwnedFlowGraphAgents(input.userId, graph);

  const templateGraph =
    input.scope.kind === "team"
      ? sanitizeFlowGraphForTeamTemplate(graph)
      : sanitizeFlowGraphForPersonalTemplate(graph);
  const triggerEvent = getStartConfig(templateGraph)?.event ?? "mention";
  const reconnect = getFlowTemplateReconnects(templateGraph);
  const requiresRepository = flowTemplateRequiresRepository(templateGraph);
  const templateValidation = validateFlowGraph(
    preparePersonalFlowTemplateGraphForValidation(templateGraph),
    { requireRunnableConfig: input.scope.kind !== "team" }
  );
  if (!templateValidation.valid) {
    throw new FlowServiceError(
      "FLOW_GRAPH_INVALID",
      templateValidation.errors[0] || "Workflow template is invalid",
      { details: templateValidation.errors }
    );
  }

  const { data, error } = await supabaseAdmin
    .from("flow_templates")
    .insert({
      ...buildResourceOwnershipInsert(input.scope),
      name: input.name?.trim() || flow.name,
      description: flow.description,
      graph: templateGraph,
      source_flow_id: input.scope.kind === "team" ? null : flow.id,
      trigger_event: triggerEvent,
      reconnect,
      requires_repository: requiresRepository,
    })
    .select("*")
    .single();

  if (error) {
    throw new FlowServiceError(
      "FLOW_STORAGE_FAILED",
      `Failed to save workflow template: ${error.message}`,
      { cause: error }
    );
  }

  const { graph: _graph, ...summary } = serializePersonalFlowTemplateRow(
    data as PersonalFlowTemplateRow
  );
  return summary;
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
  let query = supabaseAdmin
    .from("flow_templates")
    .delete()
    .eq("id", templateId);
  query = applyResourceOwnerScope(query, scope);
  const { data, error } = await query.select("id");

  if (error) {
    throw new FlowServiceError(
      "FLOW_STORAGE_FAILED",
      `Failed to delete workflow template: ${error.message}`,
      { cause: error }
    );
  }

  return Boolean(data?.length);
}
