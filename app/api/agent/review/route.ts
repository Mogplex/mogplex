import { NextResponse } from "next/server";
import { requireMachineApiAuth } from "@/lib/internal-api-auth";
import {
  serializeAutomationJobStart,
  startAutomationJobRun,
} from "@/lib/workflows/automation-job-workflow";

type AgentReviewPostDeps = {
  startAutomationJobRun: typeof startAutomationJobRun;
};

const defaultAgentReviewPostDeps: AgentReviewPostDeps = {
  startAutomationJobRun,
};

export function createAgentReviewPostHandler(
  overrides: Partial<AgentReviewPostDeps> = {}
) {
  const deps: AgentReviewPostDeps = {
    ...defaultAgentReviewPostDeps,
    ...overrides,
  };

  return async function POST(request: Request) {
    const authResponse = requireMachineApiAuth(request, "/api/agent/review");
    if (authResponse) return authResponse;

    const { jobRunId } = await request.json();
    if (!jobRunId) {
      return NextResponse.json({ error: "Missing jobRunId" }, { status: 400 });
    }

    try {
      const started = await deps.startAutomationJobRun(
        jobRunId,
        "manual_retry"
      );

      if (started.notFound) {
        return NextResponse.json({ error: "Job not found" }, { status: 404 });
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
              : "Failed to start review job",
        },
        { status: 500 }
      );
    }
  };
}

export const POST = createAgentReviewPostHandler();
