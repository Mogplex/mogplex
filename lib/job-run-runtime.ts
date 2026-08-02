import type { BackgroundRuntimeProvider } from "@/lib/runtime-providers";

type RuntimeBackedJobRun = {
  runtime_provider?: BackgroundRuntimeProvider | null;
  runtime_run_id?: string | null;
  workflow_run_id?: string | null;
};

export function getJobRunRuntimeProvider(
  run: RuntimeBackedJobRun
): BackgroundRuntimeProvider | null {
  if (run.runtime_provider) return run.runtime_provider;
  return run.workflow_run_id ? "workflow" : null;
}

export function getJobRunRuntimeRunId(run: RuntimeBackedJobRun) {
  return run.runtime_run_id ?? run.workflow_run_id ?? null;
}
