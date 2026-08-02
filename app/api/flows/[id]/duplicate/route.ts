import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import {
  getFlowServiceErrorStatus,
  isFlowServiceError,
} from "@/lib/flows/errors";
import { duplicateFlow } from "@/lib/flows/api";
import { readActiveTeamIdHeader } from "@/lib/team-capabilities";

type FlowDuplicateRouteDeps = {
  requireUserId: typeof requireUserId;
  duplicateFlow: typeof duplicateFlow;
};

export function createFlowDuplicatePostHandler(
  overrides: Partial<FlowDuplicateRouteDeps> = {}
) {
  const deps: FlowDuplicateRouteDeps = {
    requireUserId,
    duplicateFlow,
    ...overrides,
  };

  return async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
  ) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    const { id } = await params;

    try {
      // Duplication can still resolve legacy preset: IDs into forks — stamp
      // them with the request's active-team scope, matching updateFlow.
      const flow = await deps.duplicateFlow(
        userId,
        id,
        readActiveTeamIdHeader(request)
      );
      return NextResponse.json(flow, { status: 201 });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to duplicate flow";
      if (isFlowServiceError(error)) {
        return NextResponse.json(
          { error: message, code: error.code },
          { status: getFlowServiceErrorStatus(error) }
        );
      }
      return NextResponse.json({ error: message }, { status: 400 });
    }
  };
}

export const POST = createFlowDuplicatePostHandler();
