import { tasks, usage } from "@trigger.dev/sdk/v3";
import { recordTriggerProviderCost } from "@/lib/billing/trigger-provider-costs";

function payloadRecord(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === "object"
    ? (payload as Record<string, unknown>)
    : {};
}

tasks.onComplete("record-capacity-provider-cost", async ({ ctx, payload }) => {
  if (ctx.environment.type !== "PRODUCTION" || ctx.run.isTest) return;
  const input = payloadRecord(payload);
  const billingAccountId =
    typeof input.billingAccountId === "string" ? input.billingAccountId : null;
  const rootWorkflowRef =
    typeof input.jobRunId === "string" ? input.jobRunId : null;
  const current = usage.getCurrent();

  await recordTriggerProviderCost({
    runId: ctx.run.id,
    taskIdentifier: ctx.task.id,
    billingAccountId,
    rootWorkflowRef,
    totalCostInCents: current.totalCostInCents,
    durationMs: current.compute.total.durationMs,
    occurredAt: new Date(),
  });
});
