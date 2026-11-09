import { NextResponse } from "next/server";
import { requireMachineApiAuth } from "@/lib/internal-api-auth";
import { withSupabaseAdminConnection } from "@/lib/supabase/admin";
import { startAutomationJobRun } from "@/lib/workflows/automation-job-workflow";
import { isRepairablePendingJob } from "@/lib/workflows/job-run-repair";
import { isExecutableJobRunSource } from "@/lib/job-runs";

type RepairJobsHandlerDeps = {
  requireMachineApiAuth: typeof requireMachineApiAuth;
  withSupabaseAdminConnection: typeof withSupabaseAdminConnection;
  startAutomationJobRun: typeof startAutomationJobRun;
  isRepairablePendingJob: typeof isRepairablePendingJob;
  isExecutableJobRunSource: typeof isExecutableJobRunSource;
};

const defaultRepairJobsHandlerDeps: RepairJobsHandlerDeps = {
  requireMachineApiAuth,
  withSupabaseAdminConnection,
  startAutomationJobRun,
  isRepairablePendingJob,
  isExecutableJobRunSource,
};

export function createRepairJobsGetHandler(
  overrides: Partial<RepairJobsHandlerDeps> = {}
) {
  const deps: RepairJobsHandlerDeps = {
    ...defaultRepairJobsHandlerDeps,
    ...overrides,
  };

  return async function repairJobsGet(req: Request) {
    const authResponse = deps.requireMachineApiAuth(
      req,
      "/api/cron/repair-jobs"
    );
    if (authResponse) return authResponse;

    try {
      return await deps.withSupabaseAdminConnection(async (adminClient) => {
        const { data: jobs, error } = await adminClient
          .from("job_runs")
          .select(
            "id, status, flow_id, trigger_id, created_at, started_at, last_start_attempt_at"
          )
          .eq("status", "pending")
          .order("created_at", { ascending: true })
          .limit(250);

        if (error) {
          console.error("[job-repair] failed to load pending jobs", {
            error: error.message,
          });
          return NextResponse.json(
            { error: "Failed to load pending jobs" },
            { status: 500 }
          );
        }

        const staleJobs = (jobs || []).filter((job) =>
          deps.isRepairablePendingJob(job)
        );
        const repairableJobs = staleJobs.filter((job) =>
          deps.isExecutableJobRunSource(job)
        );
        const unsupportedJobs = staleJobs.filter(
          (job) => !deps.isExecutableJobRunSource(job)
        );
        const scanned = jobs?.length ?? 0;
        const skippedNotStale = scanned - staleJobs.length;
        let retiredLegacy = 0;
        let retireErrors = 0;

        // Legacy rows cannot execute. Retire them so they leave pending queues
        // instead of accumulating ahead of repairable flow runs.
        if (unsupportedJobs.length > 0) {
          try {
            const message = "Legacy job run source is not executable";
            const { error: updateError } = await adminClient
              .from("job_runs")
              .update({
                status: "failed",
                error: message,
                last_start_error: message,
                completed_at: new Date().toISOString(),
              })
              .in(
                "id",
                unsupportedJobs.map((job) => job.id)
              )
              .eq("status", "pending");
            if (updateError) throw new Error(updateError.message);
            retiredLegacy = unsupportedJobs.length;
          } catch (error) {
            retireErrors = unsupportedJobs.length;
            console.error("[job-repair] failed to retire legacy pending runs", {
              jobRunIds: unsupportedJobs.map((job) => job.id),
              error: error instanceof Error ? error.message : "Unknown error",
            });
          }
        }

        if (repairableJobs.length === 0) {
          return NextResponse.json({
            message: "No repairable pending jobs",
            scanned,
            started: 0,
            deferred: 0,
            failed: retireErrors,
            skippedNotStale,
            retireErrors,
            retiredLegacy,
          });
        }

        // One PoolClient intentionally serializes the batch's database work
        // and stays checked out across runtime dispatch. Repair batches are
        // bounded by the existing scan limit, and this prevents every nested
        // starter query from independently checking out another connection.
        const results = await Promise.all(
          repairableJobs.map(async (job) => {
            try {
              const started = await deps.startAutomationJobRun(
                job.id,
                "repair",
                adminClient
              );
              return {
                jobRunId: job.id,
                started: started.started,
                deferred: started.deferred ?? false,
                runtimeProvider: started.runtimeProvider ?? null,
                runtimeRunId:
                  started.runtimeRunId ?? started.workflowRunId ?? null,
                workflowRunId: started.workflowRunId ?? null,
                status: started.status ?? null,
                reason: started.reason ?? null,
                error: null,
              };
            } catch (startError) {
              const message =
                startError instanceof Error
                  ? startError.message
                  : "Failed to start automation run";
              console.error("[job-repair] failed to start automation run", {
                jobRunId: job.id,
                error: message,
              });
              return {
                jobRunId: job.id,
                started: false,
                deferred: false,
                runtimeProvider: null,
                runtimeRunId: null,
                workflowRunId: null,
                status: "pending",
                reason: null,
                error: message,
              };
            }
          })
        );

        return NextResponse.json({
          message: `Scanned ${scanned} pending job(s); ${staleJobs.length} stale`,
          scanned,
          started: results.filter((result) => result.started).length,
          deferred: results.filter((result) => result.deferred).length,
          failed:
            results.filter((result) => result.error).length + retireErrors,
          skippedNotStale,
          retireErrors,
          retiredLegacy,
          results,
        });
      });
    } catch (error) {
      console.error("[job-repair] failed to acquire admin connection", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return NextResponse.json(
        { error: "Failed to load pending jobs" },
        { status: 500 }
      );
    }
  };
}
