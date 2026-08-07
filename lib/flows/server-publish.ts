import {
  coerceGraph,
  validateFlowGraph,
  getStartConfig,
} from "@/lib/flows/graph";
import { FlowServiceError } from "@/lib/flows/errors";
import { syncScheduledFlowActivation } from "@/lib/flows/activation-sync";
import { runWithFlowActivationLock } from "@/lib/flows/activation-lock";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  activateFlowSchedule,
  deactivateFlowSchedule,
  deleteFlowSchedule,
  upsertFlowSchedule,
} from "@/lib/flows/schedule-manager";
import { flowTriggerSourceKind } from "@/lib/flows/trigger-source";
import type { Flow } from "@/lib/types";
import { loadOwnedFlow } from "./server-flow-ops";
import {
  assertOwnedFlowGraphAgents,
  defaultFlowPresetAgentResolverDeps,
  resolveFlowGraphPresetAgents,
} from "./server-preset-agents";

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
