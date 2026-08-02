import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { loadOwnedJobRun } from "@/lib/job-run-service";
import {
  enqueueJobRunRetry,
  getDefaultJobRunRetryVersionMode,
  isJobRunRetryVersionError,
  isJobRunRetryVersionMode,
  loadJobRunRetryContext,
  type JobRunRetryContext,
} from "@/lib/job-run-retry";
import { isRequeueableJobRun } from "@/lib/job-runs";
import {
  serializeAutomationJobStart,
  startAutomationJobRun,
} from "@/lib/workflows/automation-job-workflow";

type ObservabilityJobRequeuePostDeps = {
  requireUserId: typeof requireUserId;
  loadOwnedJobRun: typeof loadOwnedJobRun;
  loadJobRunRetryContext: (
    jobRunId: string
  ) => Promise<JobRunRetryContext | null>;
  enqueueJobRunRetry: typeof enqueueJobRunRetry;
  startAutomationJobRun: typeof startAutomationJobRun;
};

const defaultObservabilityJobRequeuePostDeps: ObservabilityJobRequeuePostDeps =
  {
    requireUserId,
    loadOwnedJobRun,
    loadJobRunRetryContext,
    enqueueJobRunRetry,
    startAutomationJobRun,
  };

async function readRequestedVersionMode(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return { provided: false, value: undefined } as const;
  }

  const body = (await request.json().catch(() => null)) as unknown;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { provided: true, value: null } as const;
  }

  const value = (body as { versionMode?: unknown }).versionMode;
  return { provided: value !== undefined, value } as const;
}

export function createObservabilityJobRequeuePostHandler(
  overrides: Partial<ObservabilityJobRequeuePostDeps> = {}
) {
  const deps: ObservabilityJobRequeuePostDeps = {
    ...defaultObservabilityJobRequeuePostDeps,
    ...overrides,
  };

  return async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
  ) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    const { id } = await params;
    const { run } = await deps.loadOwnedJobRun(userId, id);

    if (!run) {
      return NextResponse.json({ error: "Job run not found" }, { status: 404 });
    }

    if (!isRequeueableJobRun(run)) {
      return NextResponse.json(
        { error: "Job run is not requeueable" },
        { status: 400 }
      );
    }

    const retryContext = await deps.loadJobRunRetryContext(run.id);
    if (retryContext?.userId !== userId) {
      return NextResponse.json(
        { error: "Job run is not retryable" },
        { status: 400 }
      );
    }

    const requestedVersionMode = await readRequestedVersionMode(request);
    if (
      requestedVersionMode.provided &&
      !isJobRunRetryVersionMode(requestedVersionMode.value)
    ) {
      return NextResponse.json(
        { error: "versionMode must be same_version or latest_published" },
        { status: 400 }
      );
    }
    const versionMode = isJobRunRetryVersionMode(requestedVersionMode.value)
      ? requestedVersionMode.value
      : getDefaultJobRunRetryVersionMode(retryContext);

    let versionFallbackUsed = false;
    let enqueueResult: Awaited<ReturnType<typeof enqueueJobRunRetry>>;
    try {
      enqueueResult = await deps.enqueueJobRunRetry({
        retryContext,
        idempotencyKeyPrefix: "manual_retry",
        versionMode,
      });
    } catch (error) {
      // The ordinary Retry action prefers the current published flow so edits
      // (including a model switch) take effect. If that version disappeared
      // between the original run and this click, retain the pre-existing
      // ability to replay the immutable snapshot. An explicitly requested
      // latest_published retry remains strict and returns 409 below.
      if (
        isJobRunRetryVersionError(error) &&
        !requestedVersionMode.provided &&
        versionMode === "latest_published"
      ) {
        try {
          versionFallbackUsed = true;
          enqueueResult = await deps.enqueueJobRunRetry({
            retryContext,
            idempotencyKeyPrefix: "manual_retry",
            versionMode: "same_version",
            metadataPatch: {
              retry_latest_published_unavailable: true,
            },
          });
        } catch (fallbackError) {
          return NextResponse.json(
            {
              error:
                fallbackError instanceof Error
                  ? fallbackError.message
                  : "Failed to enqueue retry job",
            },
            { status: 500 }
          );
        }
      } else if (isJobRunRetryVersionError(error)) {
        return NextResponse.json(
          { error: error.message, code: error.code },
          { status: 409 }
        );
      } else {
        return NextResponse.json(
          {
            error:
              error instanceof Error
                ? error.message
                : "Failed to enqueue retry job",
          },
          { status: 500 }
        );
      }
    }

    const reusedIdempotentJob =
      enqueueResult.outcome === "suppressed" &&
      enqueueResult.reason === "IDEMPOTENT_DUPLICATE" &&
      Boolean(enqueueResult.jobRunId);

    if (
      !enqueueResult.jobRunId ||
      (enqueueResult.outcome !== "queued" && !reusedIdempotentJob)
    ) {
      return NextResponse.json({
        ok: true,
        queued: false,
        suppressed: true,
        reason: enqueueResult.reason,
        jobRunId: null,
        started: false,
        deferred: false,
        runtimeProvider: null,
        runtimeRunId: null,
        workflowRunId: null,
        status: "pending",
        versionFallbackUsed,
      });
    }

    try {
      const started = await deps.startAutomationJobRun(
        enqueueResult.jobRunId,
        "manual_retry"
      );
      const serializedStart = serializeAutomationJobStart(started);
      return NextResponse.json({
        ok: true,
        queued: enqueueResult.outcome === "queued",
        suppressed: reusedIdempotentJob,
        reused: reusedIdempotentJob,
        jobRunId: enqueueResult.jobRunId,
        ...serializedStart,
        reason: serializedStart.reason ?? enqueueResult.reason,
        versionFallbackUsed,
      });
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Failed to start retry job",
          jobRunId: enqueueResult.jobRunId,
        },
        { status: 500 }
      );
    }
  };
}

export const POST = createObservabilityJobRequeuePostHandler();
