import { coerceGraph } from "@/lib/flows/graph";
import type { Flow, PersonalFlowTemplate } from "@/lib/types";
import type {
  FlowRow,
  FlowVersionRow,
  PersonalFlowTemplateRow,
  StoredPersonalFlowTemplate,
} from "./server-types";

export function serializeFlowRow(
  row: FlowRow,
  publishedVersion?: FlowVersionRow | null
): Flow {
  const { vault_webhook_secret_id: webhookSecretId, ...publicRow } = row;
  return {
    ...publicRow,
    webhook_configured: Boolean(webhookSecretId),
    draft_graph: coerceGraph(row.draft_graph),
    published_version: publishedVersion
      ? {
          ...publishedVersion,
          graph: coerceGraph(publishedVersion.graph),
        }
      : null,
  };
}

export function serializePersonalFlowTemplateRow(
  row: PersonalFlowTemplateRow
): StoredPersonalFlowTemplate {
  return {
    id: row.id,
    owner_type: row.owner_type,
    owner_user_id: row.owner_user_id,
    product_team_id: row.product_team_id,
    created_by_user_id: row.created_by_user_id,
    name: row.name,
    description: row.description,
    graph: coerceGraph(row.graph),
    source_flow_id: row.owner_type === "team" ? null : row.source_flow_id,
    trigger_event: row.trigger_event,
    reconnect: row.reconnect,
    requires_repository: row.requires_repository,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function serializePersonalFlowTemplateSummaryRow(
  row: Omit<PersonalFlowTemplateRow, "graph" | "user_id">
): PersonalFlowTemplate {
  return {
    id: row.id,
    owner_type: row.owner_type,
    owner_user_id: row.owner_user_id,
    product_team_id: row.product_team_id,
    created_by_user_id: row.created_by_user_id,
    name: row.name,
    description: row.description,
    source_flow_id: row.owner_type === "team" ? null : row.source_flow_id,
    trigger_event: row.trigger_event,
    reconnect: row.reconnect,
    requires_repository: row.requires_repository,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
