import { coerceGraph, createDefaultFlowGraph } from "@/lib/flows/graph";
import { FlowServiceError } from "@/lib/flows/errors";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolveStoredUserDefaultModelId } from "@/lib/models/default-model";
import {
  bindFlowGraphToInstallation,
  buildFlowStarterTemplateGraph,
  getFlowStarterTemplate,
  type FlowStarterTemplateId,
} from "@/lib/flows/templates";
import type { Flow } from "@/lib/types";
import type { FlowRow, FlowVersionRow } from "./server-types";
import { serializeFlowRow } from "./server-serialization";
import {
  defaultFlowPresetAgentResolverDeps,
  resolveFlowGraphPresetAgents,
} from "./server-preset-agents";

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

export async function deleteFlow(userId: string, flowId: string) {
  const flow = await loadOwnedFlow(userId, flowId);
  if (!flow) {
    throw new FlowServiceError("FLOW_NOT_FOUND", "Flow not found");
  }

  const scheduleId = (flow as Flow & { trigger_schedule_id?: string | null })
    .trigger_schedule_id;
  if (scheduleId) {
    const { deleteFlowSchedule } = await import("@/lib/flows/schedule-manager");
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
