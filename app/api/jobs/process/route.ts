import { NextResponse } from "next/server";
import { requireMachineApiAuth } from "@/lib/internal-api-auth";
import {
  serializeAutomationJobStart,
  startAutomationJobRun,
} from "@/lib/workflows/automation-job-workflow";

type JobsProcessPostDeps = {
  startAutomationJobRun: typeof startAutomationJobRun;
};

const defaultJobsProcessPostDeps: JobsProcessPostDeps = {
  startAutomationJobRun,
};

export function createJobsProcessPostHandler(
  overrides: Partial<JobsProcessPostDeps> = {}
) {
  const deps: JobsProcessPostDeps = {
    ...defaultJobsProcessPostDeps,
    ...overrides,
  };

  return async function POST(request: Request) {
    const authResponse = requireMachineApiAuth(request, "/api/jobs/process");
    if (authResponse) return authResponse;

    const { jobId } = await request.json();
    if (!jobId) {
      return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
    }

    try {
      const started = await deps.startAutomationJobRun(jobId, "repair");

      if (started.notFound) {
        return NextResponse.json({ error: "JOB_NOT_FOUND" }, { status: 404 });
      }

      return NextResponse.json({
        ok: true,
        ...serializeAutomationJobStart(started),
      });
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Failed to start automation job",
        },
        { status: 500 }
      );
    }
  };
}

export const POST = createJobsProcessPostHandler();
