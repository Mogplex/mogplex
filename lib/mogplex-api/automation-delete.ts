import { deleteFlow, loadOwnedFlow } from "@/lib/flows/api";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { MogplexApiAutomationError } from "./automations.types";

export type DeleteMogplexApiAutomationResult = {
  deleted: true;
  automationId: string;
  name: string;
};

type DeleteAutomationDeps = {
  loadOwnedFlow: typeof loadOwnedFlow;
  listInFlightRunIds: (automationId: string) => Promise<string[]>;
  deleteFlow: typeof deleteFlow;
};

/**
 * Ids of the automation's job runs that have not reached a terminal status.
 * A run whose cancellation was requested still counts until it settles.
 */
async function listInFlightRunIds(automationId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from("job_runs")
    .select("id")
    .eq("flow_id", automationId)
    .in("status", ["pending", "running"])
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{ id: string }>).map((run) => run.id);
}

const defaults: DeleteAutomationDeps = {
  loadOwnedFlow,
  listInFlightRunIds,
  deleteFlow,
};

const NAMED_RUN_IDS = 10;

function inFlightRunsMessage(runIds: string[]) {
  const runs = runIds.length === 1 ? "run is" : "runs are";
  const named = runIds.slice(0, NAMED_RUN_IDS).join(", ");
  const unnamed = runIds.length - NAMED_RUN_IDS;
  const listed = unnamed > 0 ? `${named}, and ${unnamed} more` : named;
  return `${runIds.length} ${runs} still in flight (${listed}). Cancel every in-flight run, then delete the automation.`;
}

/**
 * Permanently deletes an automation the caller owns: its schedule, its draft
 * and published versions, and its per-node run records. Job run rows survive
 * with no automation attached.
 *
 * Deleting under a live run would remove the node records and waits that run
 * is still writing to, so an automation with in-flight runs is refused until
 * they are cancelled or finish. The check and the delete are separate
 * statements, so a run that starts between them is not caught; the schedule is
 * removed first, which leaves only an event or manual trigger in that window.
 */
export async function deleteMogplexApiAutomation(
  userId: string,
  automationId: string,
  overrides: Partial<DeleteAutomationDeps> = {}
): Promise<DeleteMogplexApiAutomationResult> {
  const deps = { ...defaults, ...overrides };
  const flow = await deps.loadOwnedFlow(userId, automationId);
  if (!flow) {
    throw new MogplexApiAutomationError(
      "AUTOMATION_NOT_FOUND",
      "Automation not found",
      404
    );
  }

  const inFlightRunIds = await deps.listInFlightRunIds(flow.id);
  if (inFlightRunIds.length > 0) {
    throw new MogplexApiAutomationError(
      "AUTOMATION_HAS_ACTIVE_RUNS",
      inFlightRunsMessage(inFlightRunIds),
      409
    );
  }

  await deps.deleteFlow(userId, flow.id);
  return { deleted: true, automationId: flow.id, name: flow.name };
}
