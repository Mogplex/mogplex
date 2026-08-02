import { NextResponse } from "next/server";
import { requireMachineApiAuth } from "@/lib/internal-api-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { startAutomationJobRun } from "@/lib/workflows/automation-job-workflow";
import { isRepairablePendingJob } from "@/lib/workflows/job-run-repair";

export async function GET(req: Request) {
  const authResponse = requireMachineApiAuth(req, "/api/cron/repair-jobs");
  if (authResponse) return authResponse;

  const { data: jobs, error } = await supabaseAdmin
    .from("job_runs")
    .select("id, status, created_at, started_at, last_start_attempt_at")
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

  const repairableJobs = (jobs || []).filter((job) =>
    isRepairablePendingJob(job)
  );

  if (repairableJobs.length === 0) {
    return NextResponse.json({
      message: "No stale pending jobs",
      scanned: jobs?.length ?? 0,
      started: 0,
      failed: 0,
    });
  }

  const results = await Promise.all(
    repairableJobs.map(async (job) => {
      try {
        const started = await startAutomationJobRun(job.id, "repair");
        return {
          jobRunId: job.id,
          started: started.started,
          deferred: started.deferred ?? false,
          runtimeProvider: started.runtimeProvider ?? null,
          runtimeRunId: started.runtimeRunId ?? started.workflowRunId ?? null,
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
    message: `Scanned ${jobs?.length ?? 0} stale pending job(s)`,
    scanned: jobs?.length ?? 0,
    started: results.filter((result) => result.started).length,
    deferred: results.filter((result) => result.deferred).length,
    failed: results.filter((result) => result.error).length,
    results,
  });
}
