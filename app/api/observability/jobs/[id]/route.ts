import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { loadOwnedJobRunDetail } from "@/lib/job-run-service";
import { loadAgentRunDetail } from "@/lib/observability/agent-run-detail";
import { z } from "zod";
import type { NextRequest } from "next/server";
import {
  buildObservabilityIncidentId,
  sanitizeObservabilityPayload,
} from "@/lib/observability/user-facing-errors";

type ObservabilityJobDetailGetDeps = {
  requireUserId: typeof requireUserId;
  loadOwnedJobRunDetail: typeof loadOwnedJobRunDetail;
  loadAgentRunDetail: typeof loadAgentRunDetail;
};

const defaultObservabilityJobDetailGetDeps: ObservabilityJobDetailGetDeps = {
  requireUserId,
  loadOwnedJobRunDetail,
  loadAgentRunDetail,
};

export function createObservabilityJobDetailGetHandler(
  overrides: Partial<ObservabilityJobDetailGetDeps> = {}
) {
  const deps: ObservabilityJobDetailGetDeps = {
    ...defaultObservabilityJobDetailGetDeps,
    ...overrides,
  };

  return async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    const { id } = await params;

    try {
      const isAgent =
        new URL(request.url).searchParams.get("source") === "agent_run";
      if (isAgent && !z.string().uuid().safeParse(id).success) {
        return NextResponse.json({ error: "Invalid run ID" }, { status: 400 });
      }
      const run = isAgent
        ? await deps.loadAgentRunDetail(userId, id)
        : (await deps.loadOwnedJobRunDetail(userId, id)).run;

      if (!run) {
        return NextResponse.json(
          { error: "Job run not found" },
          { status: 404 }
        );
      }

      return NextResponse.json({
        run: sanitizeObservabilityPayload(run, "JOB", id),
      });
    } catch (error) {
      console.error("failed to load observability job detail", {
        jobRunId: id,
        error,
      });
      const incidentId = buildObservabilityIncidentId("JOB", id);
      return NextResponse.json(
        {
          error: `Failed to load job run detail. Contact support with incident ${incidentId}.`,
        },
        { status: 500 }
      );
    }
  };
}

export const GET = createObservabilityJobDetailGetHandler();
