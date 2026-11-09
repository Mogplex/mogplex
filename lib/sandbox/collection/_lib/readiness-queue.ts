import type { SandboxEvent } from "@/lib/sandbox/events";
import type { SandboxPostDeps } from "./deps";

/**
 * Queue the launch-time readiness reconciler for `sandboxId`. The reconciler
 * guards every write on `expectedSandboxId`, so it must be re-queued whenever
 * the record is repointed at a different VM (see baseline-fallback.ts).
 */
export async function queueSandboxReadinessReconciliationWarning(input: {
  deps: Pick<SandboxPostDeps, "startSandboxReadinessReconciliation">;
  recordId: string;
  sandboxId: string;
  emit: (event: SandboxEvent) => void;
}) {
  try {
    const readinessRun = await input.deps.startSandboxReadinessReconciliation({
      sandboxRecordId: input.recordId,
      expectedSandboxId: input.sandboxId,
      source: "launch",
    });
    if (
      !readinessRun.queued &&
      readinessRun.reason !== "trigger_not_configured"
    ) {
      input.emit({
        type: "warning",
        message: "Sandbox readiness reconciliation could not be queued.",
      });
    }
  } catch (error) {
    console.error(
      "[sandbox/create] Failed to queue sandbox readiness reconciliation",
      error
    );
    input.emit({
      type: "warning",
      message: "Sandbox readiness reconciliation could not be queued.",
    });
  }
}
