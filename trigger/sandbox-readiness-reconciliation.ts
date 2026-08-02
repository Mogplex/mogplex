import { task } from "@trigger.dev/sdk/v3";
import { executeSandboxReadinessReconciliation } from "@/lib/sandbox/readiness-reconciliation";
import { TRIGGER_TASK_IDS } from "@/lib/trigger/task-ids";
import type { SandboxReadinessReconciliationInput } from "@/lib/sandbox/readiness-reconciliation";

export const reconcileSandboxReadinessTask = task({
  id: TRIGGER_TASK_IDS.sandboxReadinessReconciliation,
  maxDuration: 60 * 15,
  retry: {
    maxAttempts: 1,
  },
  run: async (payload: SandboxReadinessReconciliationInput) =>
    executeSandboxReadinessReconciliation(payload),
});
