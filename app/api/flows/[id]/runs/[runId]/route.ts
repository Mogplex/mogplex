import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import {
  getFlowServiceErrorStatus,
  isFlowServiceError,
} from "@/lib/flows/errors";
import { loadOwnedFlowRunDetail } from "@/lib/flows/api";
import type { NextRequest } from "next/server";

type FlowRunDetailRouteDeps = {
  requireUserId: typeof requireUserId;
  loadOwnedFlowRunDetail: typeof loadOwnedFlowRunDetail;
};

export function createFlowRunDetailGetHandler(
  overrides: Partial<FlowRunDetailRouteDeps> = {}
) {
  const deps: FlowRunDetailRouteDeps = {
    requireUserId,
    loadOwnedFlowRunDetail,
    ...overrides,
  };

  return async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string; runId: string }> }
  ) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    const { id, runId } = await params;

    try {
      const run = await deps.loadOwnedFlowRunDetail(userId, id, runId);
      return NextResponse.json({ run });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load flow run";
      if (isFlowServiceError(error)) {
        return NextResponse.json(
          { error: message, code: error.code },
          { status: getFlowServiceErrorStatus(error) }
        );
      }
      return NextResponse.json({ error: message }, { status: 500 });
    }
  };
}

export const GET = createFlowRunDetailGetHandler();
