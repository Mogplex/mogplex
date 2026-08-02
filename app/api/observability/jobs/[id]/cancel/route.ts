import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { loadOwnedJobRun } from "@/lib/job-run-service";
import { cancelAutomationJobRun } from "@/lib/workflows/job-run-cancel";

type ObservabilityJobCancelPostDeps = {
  requireUserId: typeof requireUserId;
  loadOwnedJobRun: typeof loadOwnedJobRun;
  cancelAutomationJobRun: typeof cancelAutomationJobRun;
};

const defaultObservabilityJobCancelPostDeps: ObservabilityJobCancelPostDeps = {
  requireUserId,
  loadOwnedJobRun,
  cancelAutomationJobRun,
};

export function createObservabilityJobCancelPostHandler(
  overrides: Partial<ObservabilityJobCancelPostDeps> = {}
) {
  const deps: ObservabilityJobCancelPostDeps = {
    ...defaultObservabilityJobCancelPostDeps,
    ...overrides,
  };

  return async function POST(
    _: Request,
    { params }: { params: Promise<{ id: string }> }
  ) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    const { id } = await params;
    const { run } = await deps.loadOwnedJobRun(userId, id);

    if (!run) {
      return NextResponse.json({ error: "Job run not found" }, { status: 404 });
    }

    try {
      const cancelled = await deps.cancelAutomationJobRun(id);

      if (!cancelled.ok) {
        if (cancelled.notFound) {
          return NextResponse.json(
            { error: "Job run not found" },
            { status: 404 }
          );
        }

        return NextResponse.json(
          {
            error: "Job run is not cancelable",
            status: cancelled.status,
            cancelRequestedAt: cancelled.cancelRequestedAt,
            cancelledAt: cancelled.cancelledAt,
            cancelReason: cancelled.cancelReason,
            cancelError: cancelled.cancelError,
          },
          { status: 409 }
        );
      }

      return NextResponse.json({
        ok: true,
        status: cancelled.status,
        cancelRequestedAt: cancelled.cancelRequestedAt,
        cancelledAt: cancelled.cancelledAt,
        cancelReason: cancelled.cancelReason,
        cancelError: cancelled.cancelError,
        runtimeProvider: cancelled.runtimeProvider ?? null,
        runtimeRunId: cancelled.runtimeRunId ?? null,
        aiCallsCancellationRequested: cancelled.aiCallsCancellationRequested,
        releasedJobs: cancelled.releasedJobs,
      });
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error ? error.message : "Failed to cancel job run",
        },
        { status: 500 }
      );
    }
  };
}

export const POST = createObservabilityJobCancelPostHandler();
