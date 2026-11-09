import type { JobRunStartSource } from "@/lib/job-runs";
import {
  loadAutomationScopesByStatus,
  selectQueuedJobsToStart,
} from "./automation-guardrails";
import type { AutomationScope } from "./automation-guardrails";

type StartAutomationJobRun = (
  jobRunId: string,
  source: JobRunStartSource
) => Promise<{ started: boolean; reason?: string | null }>;

export async function releaseQueuedAutomationJobs(input: {
  releasedScope: AutomationScope;
  startAutomationJobRun: StartAutomationJobRun;
}) {
  const { releasedScope } = input;
  if (!releasedScope.repoId && releasedScope.installationId == null) return [];

  const scopes = await loadAutomationScopesByStatus(["pending", "running"]);
  const nextJobIds = selectQueuedJobsToStart({
    releasedScope,
    pendingScopes: scopes.filter(
      (scope) =>
        scope.status === "pending" && scope.jobRunId !== releasedScope.jobRunId
    ),
    runningScopes: scopes.filter(
      (scope) =>
        scope.status === "running" && scope.jobRunId !== releasedScope.jobRunId
    ),
  });

  return Promise.all(
    nextJobIds.map(async (jobRunId) => {
      try {
        const started = await input.startAutomationJobRun(
          jobRunId,
          "queue_release"
        );
        return {
          jobRunId,
          started: started.started,
          reason: started.reason ?? null,
        };
      } catch (error) {
        return {
          jobRunId,
          started: false,
          reason:
            error instanceof Error
              ? error.message
              : "Failed to release queued job",
        };
      }
    })
  );
}
