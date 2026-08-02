import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import {
  getFlowServiceErrorStatus,
  isFlowServiceError,
} from "@/lib/flows/errors";
import { listOwnedFlowRuns } from "@/lib/flows/api";
import type { NextRequest } from "next/server";

type FlowRunsRouteDeps = {
  requireUserId: typeof requireUserId;
  listOwnedFlowRuns: typeof listOwnedFlowRuns;
};

export function createFlowRunsGetHandler(
  overrides: Partial<FlowRunsRouteDeps> = {}
) {
  const deps: FlowRunsRouteDeps = {
    requireUserId,
    listOwnedFlowRuns,
    ...overrides,
  };

  return async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    const { id } = await params;
    const limit = Math.min(
      50,
      Math.max(1, Number(request.nextUrl.searchParams.get("limit") || "12"))
    );

    try {
      const runs = await deps.listOwnedFlowRuns(userId, id, limit);
      return NextResponse.json({ runs });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load flow runs";
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

export const GET = createFlowRunsGetHandler();
