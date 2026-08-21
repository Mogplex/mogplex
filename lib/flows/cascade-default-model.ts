import { coerceGraph } from "@/lib/flows/graph";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { FlowGraph } from "@/lib/types/flow";

export type CascadeAutomationModelResult = {
  draftsUpdated: number;
  versionsPublished: number;
  failed: number;
};

export type CascadeAutomationModelInput = {
  userId: string;
  // Every model id that counted as "the old default" for this user: the raw
  // stored preference plus its resolved form. A node pinned to any of them is
  // treated as following the default; anything else is an explicit user pick.
  previousModelIds: string[];
  nextModelId: string;
};

type CascadeFlowRow = {
  id: string;
  draft_graph: unknown;
  published_version_id: string | null;
};

export type CascadeAutomationModelDeps = {
  loadFlows: (userId: string) => Promise<CascadeFlowRow[]>;
  loadPublishedVersionGraph: (
    versionId: string
  ) => Promise<{ id: string; graph: unknown } | null>;
  loadLatestVersionNumber: (flowId: string) => Promise<number>;
  saveDraftGraph: (
    flowId: string,
    userId: string,
    graph: FlowGraph
  ) => Promise<void>;
  insertFlowVersion: (input: {
    flowId: string;
    versionNumber: number;
    graph: FlowGraph;
  }) => Promise<{ id: string }>;
  deleteFlowVersion: (versionId: string) => Promise<void>;
  // Compare-and-swap: moves the pointer only when it still equals
  // expectedVersionId — the version the new graph was derived from.
  // Returns whether the move happened.
  setPublishedVersion: (
    flowId: string,
    userId: string,
    versionId: string,
    expectedVersionId: string
  ) => Promise<boolean>;
};

// Returns the input graph untouched when nothing matched so callers can skip
// the write entirely. Only agent-node primary pins move; an explicit
// fallbackModelOverride is a deliberate user pick and is left alone.
export function rewriteFlowGraphModelPins(
  graph: FlowGraph,
  previousModelIds: ReadonlySet<string>,
  nextModelId: string
): { graph: FlowGraph; replaced: number } {
  let replaced = 0;
  const nodes = graph.nodes.map((node) => {
    if (node.type !== "agent") return node;
    const current = node.data.modelOverride;
    if (typeof current !== "string" || !previousModelIds.has(current)) {
      return node;
    }
    replaced += 1;
    return {
      ...node,
      data: { ...node.data, modelOverride: nextModelId },
    };
  });
  if (replaced === 0) return { graph, replaced };
  return { graph: { ...graph, nodes }, replaced };
}

const defaultCascadeDeps: CascadeAutomationModelDeps = {
  async loadFlows(userId) {
    const { data, error } = await supabaseAdmin
      .from("flows")
      .select("id, draft_graph, published_version_id")
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return (data ?? []) as CascadeFlowRow[];
  },
  async loadPublishedVersionGraph(versionId) {
    const { data, error } = await supabaseAdmin
      .from("flow_versions")
      .select("id, graph")
      .eq("id", versionId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  },
  async loadLatestVersionNumber(flowId) {
    const { data, error } = await supabaseAdmin
      .from("flow_versions")
      .select("version_number")
      .eq("flow_id", flowId)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data?.version_number ?? 0;
  },
  async saveDraftGraph(flowId, userId, graph) {
    // Deliberately does not bump updated_at: this is a system-initiated pin
    // rewrite, not a user edit, and the timestamp drives draft-sync/activation
    // side effects (same rule as the model-supersession reconciler).
    const { error } = await supabaseAdmin
      .from("flows")
      .update({ draft_graph: graph })
      .eq("id", flowId)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
  },
  async insertFlowVersion({ flowId, versionNumber, graph }) {
    const { data, error } = await supabaseAdmin
      .from("flow_versions")
      .insert({ flow_id: flowId, version_number: versionNumber, graph })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return data;
  },
  async deleteFlowVersion(versionId) {
    const { error } = await supabaseAdmin
      .from("flow_versions")
      .delete()
      .eq("id", versionId);
    if (error) throw new Error(error.message);
  },
  async setPublishedVersion(flowId, userId, versionId, expectedVersionId) {
    // The eq on published_version_id is the compare-and-swap guard: if a user
    // publish moved the pointer after loadFlows read it, this update matches
    // zero rows and the newer publication stays active.
    const { data, error } = await supabaseAdmin
      .from("flows")
      .update({ published_version_id: versionId })
      .eq("id", flowId)
      .eq("user_id", userId)
      .eq("published_version_id", expectedVersionId)
      .select("id");
    if (error) throw new Error(error.message);
    return (data?.length ?? 0) > 0;
  },
};

// Cascades a default-model change into the user's automations. Draft pins move
// in place; a published automation gets a NEW flow_versions row (published
// graphs are immutable history — the supersession reconciler's rule) and the
// flow's published_version_id pointer moves to it, which is what trigger
// dispatch reads at run time. Schedules, status, and unpublished draft edits
// are untouched.
//
// The draft save is load-modify-write with the same optimistic-concurrency
// profile as updateFlow: a concurrent canvas autosave can clobber the pin
// rewrite. That is accepted here as it is there — a default-model change is a
// rare, user-initiated action. The published pointer is NOT optimistic: the
// setPublishedVersion compare-and-swap only moves it when it still equals the
// version the new graph was derived from, so a concurrent user publish can
// never be silently reverted by the cascade.
//
// Per-flow failures are isolated and counted rather than aborting the sweep:
// the settings save has already succeeded by the time this runs, so a half
// done cascade with a failure count beats a 500 that implies the default was
// not saved.
export async function cascadeDefaultModelToAutomations(
  input: CascadeAutomationModelInput,
  deps: CascadeAutomationModelDeps = defaultCascadeDeps
): Promise<CascadeAutomationModelResult> {
  const previousModelIds = new Set(input.previousModelIds);
  const result: CascadeAutomationModelResult = {
    draftsUpdated: 0,
    versionsPublished: 0,
    failed: 0,
  };
  if (previousModelIds.size === 0) return result;

  const flows = await deps.loadFlows(input.userId);

  for (const flow of flows) {
    try {
      const draft = rewriteFlowGraphModelPins(
        coerceGraph(flow.draft_graph),
        previousModelIds,
        input.nextModelId
      );
      if (draft.replaced > 0) {
        await deps.saveDraftGraph(flow.id, input.userId, draft.graph);
        result.draftsUpdated += 1;
      }

      if (!flow.published_version_id) continue;
      const version = await deps.loadPublishedVersionGraph(
        flow.published_version_id
      );
      if (!version) continue;
      const published = rewriteFlowGraphModelPins(
        coerceGraph(version.graph),
        previousModelIds,
        input.nextModelId
      );
      if (published.replaced === 0) continue;

      const latestVersionNumber = await deps.loadLatestVersionNumber(flow.id);
      const newVersion = await deps.insertFlowVersion({
        flowId: flow.id,
        versionNumber: latestVersionNumber + 1,
        graph: published.graph,
      });
      const moved = await deps.setPublishedVersion(
        flow.id,
        input.userId,
        newVersion.id,
        flow.published_version_id
      );
      if (!moved) {
        // A user publish landed between loadFlows and now: their newer
        // version stays active, the just-inserted version would be orphaned
        // history, and the flow is reported so the user knows it was not
        // cascaded.
        await deps.deleteFlowVersion(newVersion.id).catch(() => undefined);
        result.failed += 1;
        console.error("Automation model cascade skipped for flow", {
          flowId: flow.id,
          reason: "published version changed during cascade",
        });
        continue;
      }
      result.versionsPublished += 1;
    } catch (error) {
      result.failed += 1;
      console.error("Automation model cascade failed for flow", {
        flowId: flow.id,
        error,
      });
    }
  }

  return result;
}
