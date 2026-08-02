import {
  cloneFlowGraph,
  coerceGraph,
  createDefaultFlowGraph,
  getStartConfig,
  validateFlowGraph,
} from "@/lib/flows/graph";
import {
  findPreconfiguredAgentTemplate,
  resolveAgentTemplateFork,
} from "@/lib/agents/template-forks";
import { FlowServiceError } from "@/lib/flows/errors";
import { syncScheduledFlowActivation } from "@/lib/flows/activation-sync";
import { runWithFlowActivationLock } from "@/lib/flows/activation-lock";
import { resolveStoredUserDefaultModelId } from "@/lib/models/default-model";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  activateFlowSchedule,
  deactivateFlowSchedule,
  deleteFlowSchedule,
  upsertFlowSchedule,
} from "@/lib/flows/schedule-manager";
import { flowTriggerSourceKind } from "@/lib/flows/trigger-source";
import {
  getFlowTemplateReconnects,
  bindFlowGraphToInstallation,
  buildFlowStarterTemplateGraph,
  flowTemplateRequiresRepository,
  getFlowStarterTemplate,
  preparePersonalFlowTemplateGraphForValidation,
  sanitizeFlowGraphForPersonalTemplate,
  sanitizeFlowGraphForTeamTemplate,
  type FlowStarterTemplateId,
} from "@/lib/flows/templates";
import {
  applyResourceOwnerScope,
  buildResourceOwnershipInsert,
  type ProductResourceScope,
} from "@/lib/team-resource-scope";
import type { PreconfiguredAgentTemplate } from "@/lib/agents/template-forks";
import type {
  Flow,
  FlowGraph,
  PersonalFlowTemplate,
  PersonalFlowTemplateReconnect,
} from "@/lib/types";

export type FlowRow = {
  id: string;
  user_id: string;
  installation_id: number;
  name: string;
  description: string | null;
  notes: string | null;
  source_kind: "github" | "schedule" | "webhook" | "slack";
  status: "active" | "inactive";
  draft_graph: unknown;
  published_version_id: string | null;
  trigger_schedule_id: string | null;
  vault_webhook_secret_id: string | null;
  created_at: string;
  updated_at: string;
};

export type FlowVersionRow = {
  id: string;
  flow_id: string;
  version_number: number;
  graph: unknown;
  created_at: string;
};

export type PersonalFlowTemplateRow = {
  id: string;
  user_id: string;
  owner_type: "user" | "team";
  owner_user_id: string | null;
  product_team_id: string | null;
  created_by_user_id: string | null;
  name: string;
  description: string | null;
  graph: unknown;
  source_flow_id: string | null;
  trigger_event: PersonalFlowTemplate["trigger_event"];
  reconnect: PersonalFlowTemplateReconnect[];
  requires_repository: boolean;
  created_at: string;
  updated_at: string;
};

type StoredPersonalFlowTemplate = PersonalFlowTemplate & {
  graph: FlowGraph;
};

type FlowPresetAgentResolverDeps = {
  resolveTemplateAgentFork: (
    userId: string,
    template: PreconfiguredAgentTemplate,
    // Verified active-team scope from the request header (null = personal).
    // Must reach the default-model resolver so the immutable fork is stamped
    // with the same scope the UI displayed when the preset was selected.
    teamId: string | null
  ) => Promise<{ id: string } | null>;
};

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

const defaultFlowPresetAgentResolverDeps: FlowPresetAgentResolverDeps = {
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

async function repairFlowPublicationConsistency(userId: string, row: FlowRow) {
  if (row.status !== "active" || row.published_version_id) {
    return row;
  }

  const { data: latestVersion, error: latestVersionError } = await supabaseAdmin
    .from("flow_versions")
    .select("id")
    .eq("flow_id", row.id)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestVersionError) {
    throw new FlowServiceError(
      "FLOW_STORAGE_FAILED",
      `Failed to inspect published flow versions: ${latestVersionError.message}`,
      {
        cause: latestVersionError,
      }
    );
  }

  const patch = latestVersion?.id
    ? {
        published_version_id: latestVersion.id,
        updated_at: new Date().toISOString(),
      }
    : {
        status: "inactive" as const,
        updated_at: new Date().toISOString(),
      };

  const { data: repairedRow, error: repairError } = await supabaseAdmin
    .from("flows")
    .update(patch)
    .eq("id", row.id)
    .eq("user_id", userId)
    .select("*")
    .single();

  if (repairError) {
    throw new FlowServiceError(
      "FLOW_STORAGE_FAILED",
      `Failed to repair inconsistent flow publication state: ${repairError.message}`,
      {
        cause: repairError,
      }
    );
  }

  return repairedRow as FlowRow;
}

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

function serializePersonalFlowTemplateSummaryRow(
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
) {
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

export async function loadOwnedFlow(userId: string, flowId: string) {
  const { data: flow, error } = await supabaseAdmin
    .from("flows")
    .select("*")
    .eq("id", flowId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new FlowServiceError(
      "FLOW_STORAGE_FAILED",
      `Failed to load flow: ${error.message}`,
      {
        cause: error,
      }
    );
  }

  if (!flow) return null;

  const consistentFlow = await repairFlowPublicationConsistency(
    userId,
    flow as FlowRow
  );

  let publishedVersion: FlowVersionRow | null = null;
  if (consistentFlow.published_version_id) {
    const { data, error: versionError } = await supabaseAdmin
      .from("flow_versions")
      .select("*")
      .eq("id", consistentFlow.published_version_id)
      .maybeSingle();

    if (versionError) {
      throw new FlowServiceError(
        "FLOW_STORAGE_FAILED",
        `Failed to load published flow version: ${versionError.message}`,
        {
          cause: versionError,
        }
      );
    }
    publishedVersion = data as FlowVersionRow | null;
  }

  return serializeFlowRow(consistentFlow, publishedVersion);
}

export async function loadFlowVersionRow(flowVersionId: string) {
  const { data, error } = await supabaseAdmin
    .from("flow_versions")
    .select("*")
    .eq("id", flowVersionId)
    .maybeSingle();

  if (error) {
    throw new FlowServiceError(
      "FLOW_STORAGE_FAILED",
      `Failed to load published flow version: ${error.message}`,
      {
        cause: error,
      }
    );
  }

  return data as FlowVersionRow | null;
}

export async function buildDefaultFlowDraft(input: {
  userId: string;
  installationId: number;
  name?: string | null;
  templateId?: FlowStarterTemplateId | null;
  teamId?: string | null;
}) {
  const [{ data: agent }, scopedDefaultModelId] = await Promise.all([
    supabaseAdmin
      .from("agents")
      .select("id, name")
      .eq("user_id", input.userId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    // The node owns the model, so a new graph is born pinned to one. Resolve
    // the model this scope can actually invoke rather than the build-time
    // constant: a workspace whose only usable credential is OpenAI would
    // otherwise get a graph that publishes cleanly and fails on first run.
    // Null (no usable model in scope) falls through to the constant, which
    // keeps the graph publishable — the editor's model select is where the
    // user resolves it.
    resolveStoredUserDefaultModelId(input.userId, {
      teamId: input.teamId ?? null,
    }).catch((error) => {
      console.error(
        "[flows] failed to resolve default model for new flow draft",
        error
      );
      return null;
    }),
  ]);

  const graph = bindFlowGraphToInstallation(
    input.templateId
      ? buildFlowStarterTemplateGraph({
          templateId: input.templateId,
          agentId: agent?.id ?? null,
          agentName: agent?.name ?? "Agent",
          modelId: scopedDefaultModelId,
        })
      : createDefaultFlowGraph({
          agentId: agent?.id ?? null,
          agentName: agent?.name ?? "Agent",
          modelId: scopedDefaultModelId,
        }),
    input.installationId
  );
  const template = input.templateId
    ? getFlowStarterTemplate(input.templateId)
    : null;

  return {
    name: input.name?.trim() || template?.name || "Untitled flow",
    description: template?.description ?? null,
    draftGraph: graph,
  };
}

export async function publishFlowDraft(
  userId: string,
  flowId: string,
  teamId: string | null = null
) {
  const flow = await loadOwnedFlow(userId, flowId);
  if (!flow) {
    throw new FlowServiceError("FLOW_NOT_FOUND", "Flow not found");
  }

  // resolveFlowGraphPresetAgents replaces any remaining preset:* agent IDs
  // with real UUID-backed agent rows. The resolved graph is then written back
  // to both flow_versions.graph and flows.draft_graph so that:
  //   1. The published version always stores plain UUIDs (no preset: strings).
  //   2. Retries of publishFlowDraft are idempotent — there are no preset: IDs
  //      left to re-resolve on a second call.
  // This intentionally overwrites the preset: IDs in the draft with their
  // resolved UUIDs. The canvas can continue to save future edits normally.
  //
  // Note: if updateFlow already resolved preset: IDs before persisting the
  // draft, this call is a no-op (no preset: prefixes remain in the graph).
  // It is kept here as a safety net for drafts that reach publish without
  // going through updateFlow first (e.g. direct API calls or future code paths).
  //
  // Concurrent-edit race: the draft_graph write below uses the snapshot loaded
  // by loadOwnedFlow above. A concurrent updateFlow call that saves a new draft
  // between loadOwnedFlow and the flows.update will have its changes silently
  // replaced by this publish-time snapshot. This is consistent with the
  // existing optimistic-update pattern in the codebase and is acceptable
  // because publish is treated as an authoritative, user-initiated action.
  // If stronger consistency is ever needed, add an optimistic lock on
  // flows.updated_at (reject if it changed since loadOwnedFlow ran).
  const graph = await resolveFlowGraphPresetAgents(
    userId,
    coerceGraph(flow.draft_graph),
    defaultFlowPresetAgentResolverDeps,
    teamId
  );
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

  await assertOwnedFlowGraphAgents(userId, graph);
  const startConfig = getStartConfig(graph);
  if (!startConfig) {
    throw new FlowServiceError(
      "FLOW_GRAPH_INVALID",
      "Flow start configuration is missing."
    );
  }
  if (
    startConfig.event === "webhook" &&
    !(flow as Flow & { webhook_configured?: boolean }).webhook_configured
  ) {
    throw new FlowServiceError(
      "FLOW_GRAPH_INVALID",
      "Generate a webhook signing secret before publishing this flow."
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
    const { data: installation, error: installationError } = await supabaseAdmin
      .from("github_installations")
      .select("id")
      .eq("user_id", userId)
      .eq("installation_id", publishedInstallationId)
      .maybeSingle();
    if (installationError) {
      throw new FlowServiceError(
        "FLOW_PUBLISH_SYNC_FAILED",
        `Failed to validate flow installation: ${installationError.message}`,
        {
          cause: installationError,
        }
      );
    }
    if (!installation) {
      throw new FlowServiceError(
        "FLOW_INSTALLATION_NOT_FOUND",
        "Installation not found"
      );
    }
  }

  const { data: latestVersion, error: latestVersionError } = await supabaseAdmin
    .from("flow_versions")
    .select("version_number")
    .eq("flow_id", flow.id)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestVersionError) {
    throw new FlowServiceError(
      "FLOW_PUBLISH_SYNC_FAILED",
      `Failed to compute next flow version: ${latestVersionError.message}`,
      {
        cause: latestVersionError,
      }
    );
  }

  const versionNumber = (latestVersion?.version_number ?? 0) + 1;

  const { data: version, error: versionError } = await supabaseAdmin
    .from("flow_versions")
    .insert({
      flow_id: flow.id,
      version_number: versionNumber,
      graph,
    })
    .select("*")
    .single();

  if (versionError) {
    throw new FlowServiceError(
      "FLOW_PUBLISH_SYNC_FAILED",
      `Failed to publish flow: ${versionError.message}`,
      {
        cause: versionError,
      }
    );
  }

  const { error: flowError } = await supabaseAdmin
    .from("flows")
    .update({
      installation_id: publishedInstallationId,
      published_version_id: version.id,
      draft_graph: graph,
      status: "active",
      source_kind: flowTriggerSourceKind(startConfig.event),
      updated_at: new Date().toISOString(),
    })
    .eq("id", flow.id)
    .eq("user_id", userId);

  if (flowError) {
    throw new FlowServiceError(
      "FLOW_PUBLISH_SYNC_FAILED",
      `Failed to save published flow version: ${flowError.message}`,
      {
        cause: flowError,
      }
    );
  }

  const storedFlow = flow as Flow & { trigger_schedule_id?: string | null };
  if (startConfig.event === "schedule") {
    let scheduleId: string | null = storedFlow.trigger_schedule_id ?? null;
    try {
      scheduleId = await upsertFlowSchedule(
        flow.id,
        {
          cron: startConfig.scheduleCron ?? "",
          timezone: startConfig.scheduleTimezone ?? "UTC",
        },
        scheduleId
      );
      await activateFlowSchedule(scheduleId);
      if (scheduleId !== (storedFlow.trigger_schedule_id ?? null)) {
        const { error: scheduleStoreError } = await supabaseAdmin
          .from("flows")
          .update({ trigger_schedule_id: scheduleId })
          .eq("id", flow.id)
          .eq("user_id", userId);
        if (scheduleStoreError) {
          await deleteFlowSchedule(scheduleId).catch(() => undefined);
          throw scheduleStoreError;
        }
      }
    } catch (error) {
      if (scheduleId) {
        await deactivateFlowSchedule(scheduleId).catch(() => undefined);
      }
      await supabaseAdmin
        .from("flows")
        .update({ status: "inactive" })
        .eq("id", flow.id)
        .eq("user_id", userId);
      throw new FlowServiceError(
        "FLOW_PUBLISH_SYNC_FAILED",
        "The workflow was published but its schedule could not be activated.",
        { cause: error }
      );
    }
  } else if (storedFlow.trigger_schedule_id) {
    try {
      await deleteFlowSchedule(storedFlow.trigger_schedule_id);
    } catch (error) {
      await supabaseAdmin
        .from("flows")
        .update({ status: "inactive" })
        .eq("id", flow.id)
        .eq("user_id", userId);
      throw new FlowServiceError(
        "FLOW_PUBLISH_SYNC_FAILED",
        "The workflow was published but its obsolete schedule could not be removed.",
        { cause: error }
      );
    }
    const { error: scheduleClearError } = await supabaseAdmin
      .from("flows")
      .update({ trigger_schedule_id: null })
      .eq("id", flow.id)
      .eq("user_id", userId);
    if (scheduleClearError) {
      await supabaseAdmin
        .from("flows")
        .update({ status: "inactive" })
        .eq("id", flow.id)
        .eq("user_id", userId);
      throw new FlowServiceError(
        "FLOW_PUBLISH_SYNC_FAILED",
        `The obsolete schedule was removed but its reference could not be cleared: ${scheduleClearError.message}`,
        { cause: scheduleClearError }
      );
    }
  }

  return loadOwnedFlow(userId, flowId);
}

export async function syncFlowActivation(
  userId: string,
  flowId: string,
  status: "active" | "inactive"
) {
  const ownedFlow = await loadOwnedFlow(userId, flowId);
  if (!ownedFlow) {
    throw new FlowServiceError("FLOW_NOT_FOUND", "Flow not found");
  }

  return runWithFlowActivationLock(flowId, async () => {
    const flow = await loadOwnedFlow(userId, flowId);
    if (!flow) {
      throw new FlowServiceError("FLOW_NOT_FOUND", "Flow not found");
    }

    if (status === "active" && !flow.published_version_id) {
      throw new FlowServiceError(
        "FLOW_UNPUBLISHED_ACTIVATION",
        "A flow must be published before it can be activated."
      );
    }

    const flowWithSchedule = flow as Flow & {
      trigger_schedule_id?: string | null;
    };
    await syncScheduledFlowActivation({
      previousStatus: flow.status,
      nextStatus: status,
      scheduleId: flowWithSchedule.trigger_schedule_id ?? null,
      setScheduleStatus: async (scheduleId, scheduleStatus) => {
        await (scheduleStatus === "active"
          ? activateFlowSchedule(scheduleId)
          : deactivateFlowSchedule(scheduleId));
      },
      persistStatus: async () => {
        const { error } = await supabaseAdmin
          .from("flows")
          .update({
            status,
            updated_at: new Date().toISOString(),
          })
          .eq("id", flow.id)
          .eq("user_id", userId);
        if (error) throw error;
      },
    });

    return loadOwnedFlow(userId, flowId);
  });
}

export async function deleteFlow(userId: string, flowId: string) {
  const flow = await loadOwnedFlow(userId, flowId);
  if (!flow) {
    throw new FlowServiceError("FLOW_NOT_FOUND", "Flow not found");
  }

  const scheduleId = (flow as Flow & { trigger_schedule_id?: string | null })
    .trigger_schedule_id;
  if (scheduleId) {
    try {
      await deleteFlowSchedule(scheduleId);
    } catch (error) {
      throw new FlowServiceError(
        "FLOW_DELETE_SYNC_FAILED",
        "Failed to delete the workflow schedule. The workflow was not deleted.",
        { cause: error }
      );
    }
  }

  const { error } = await supabaseAdmin
    .from("flows")
    .delete()
    .eq("id", flowId)
    .eq("user_id", userId);

  if (error) {
    throw new FlowServiceError(
      "FLOW_DELETE_SYNC_FAILED",
      `Failed to delete flow: ${error.message}`,
      {
        cause: error,
      }
    );
  }

  return { ok: true as const };
}

export async function duplicateFlow(
  userId: string,
  flowId: string,
  teamId: string | null = null
) {
  const flow = await loadOwnedFlow(userId, flowId);
  if (!flow) {
    throw new FlowServiceError("FLOW_NOT_FOUND", "Flow not found");
  }

  // Older drafts can still contain preset:* IDs. Normalize the duplicated
  // draft the same way updateFlow and publishFlowDraft do so copies never
  // carry legacy preset references forward.
  //
  // Any FlowServiceError thrown by resolveFlowGraphPresetAgents propagates
  // uncaught to the caller (api.ts -> duplicateFlow route handler). The route
  // handler surfaces it as a 500; the FlowServiceError code (e.g.
  // FLOW_STORAGE_FAILED, FLOW_AGENT_FORBIDDEN) is not currently translated
  // into a typed HTTP response on this path, consistent with the pre-existing
  // duplicateFlow error propagation pattern. If typed error responses are
  // needed for duplicateFlow callers, align with the updateFlow error
  // translation pattern in the route handler.
  const graph = await resolveFlowGraphPresetAgents(
    userId,
    coerceGraph(flow.draft_graph),
    defaultFlowPresetAgentResolverDeps,
    teamId
  );

  const { data: duplicate, error } = await supabaseAdmin
    .from("flows")
    .insert({
      user_id: userId,
      installation_id: flow.installation_id,
      name: `${flow.name} Copy`,
      description: flow.description,
      notes: flow.notes,
      source_kind: flow.source_kind,
      status: "inactive",
      draft_graph: graph,
    })
    .select("*")
    .single();

  if (error) {
    throw new FlowServiceError(
      "FLOW_STORAGE_FAILED",
      `Failed to duplicate flow: ${error.message}`,
      {
        cause: error,
      }
    );
  }

  return serializeFlowRow(duplicate as FlowRow);
}
