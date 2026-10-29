import { supabaseAdmin } from "@/lib/supabase/admin";
import { FlowServiceError } from "./errors";
import type { FlowGraph } from "@/lib/types";
import type { FlowVersionRow } from "./server-types";

// Caller holds the flow activation lock, shared by publish and draft tests.
export async function saveFlowVersion(flowId: string, graph: FlowGraph) {
  const { data: latest, error: latestError } = await supabaseAdmin
    .from("flow_versions")
    .select("version_number")
    .eq("flow_id", flowId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError)
    throw new FlowServiceError(
      "FLOW_STORAGE_FAILED",
      "Could not read workflow versions.",
      { cause: latestError }
    );
  const { data, error } = await supabaseAdmin
    .from("flow_versions")
    .insert({
      flow_id: flowId,
      version_number: (latest?.version_number ?? 0) + 1,
      graph,
    })
    .select("*")
    .single();
  if (error)
    throw new FlowServiceError(
      "FLOW_STORAGE_FAILED",
      "Could not save the workflow version.",
      { cause: error }
    );
  return data as FlowVersionRow;
}
