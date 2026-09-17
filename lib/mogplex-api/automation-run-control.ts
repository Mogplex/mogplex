import { supabaseAdmin } from "@/lib/supabase/admin";
import { cancelAutomationJobRun } from "@/lib/workflows/job-run-cancel";
import type { CancelAutomationJobRunResult } from "@/lib/workflows/job-run-cancel";
import { MogplexApiAutomationError } from "./automations.types";

export type AutomationRunCancelResult = Extract<
  CancelAutomationJobRunResult,
  { ok: true }
> & { automationId: string; runId: string };

export async function cancelMogplexApiAutomationRun(
  userId: string,
  automationId: string,
  runId: string
): Promise<AutomationRunCancelResult> {
  const { data: flow, error: flowError } = await supabaseAdmin
    .from("flows")
    .select("id")
    .eq("id", automationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (flowError) throw new Error(flowError.message);
  if (!flow) {
    throw new MogplexApiAutomationError(
      "AUTOMATION_NOT_FOUND",
      "Automation not found",
      404
    );
  }
  const { data: run, error: runError } = await supabaseAdmin
    .from("job_runs")
    .select("id")
    .eq("id", runId)
    .eq("flow_id", automationId)
    .maybeSingle();
  if (runError) throw new Error(runError.message);
  if (!run) {
    throw new MogplexApiAutomationError(
      "AUTOMATION_RUN_NOT_FOUND",
      "Automation run not found",
      404
    );
  }
  const result = await cancelAutomationJobRun(run.id);
  if (!result.ok) {
    throw new MogplexApiAutomationError(
      result.notFound
        ? "AUTOMATION_RUN_NOT_FOUND"
        : "AUTOMATION_RUN_NOT_CANCELABLE",
      result.notFound
        ? "Automation run not found"
        : `Automation run is not cancelable (status: ${result.status})`,
      result.notFound ? 404 : 409
    );
  }
  return { ...result, automationId, runId };
}
