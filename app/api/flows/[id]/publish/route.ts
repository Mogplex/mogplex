import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import {
  getFlowServiceErrorStatus,
  isFlowServiceError,
} from "@/lib/flows/errors";
import { publishFlowDraft } from "@/lib/flows/api";
import {
  ALLOWLIST_UNAVAILABLE_RETRY_AFTER_SECONDS,
  isModelAllowlistUnavailableError,
  MODEL_ALLOWLIST_UNAVAILABLE_ERROR,
  readActiveTeamIdHeader,
} from "@/lib/team-capabilities";

type FlowPublishRouteDeps = {
  requireUserId: typeof requireUserId;
  publishFlowDraft: typeof publishFlowDraft;
};

export function createFlowPublishPostHandler(
  overrides: Partial<FlowPublishRouteDeps> = {}
) {
  const deps: FlowPublishRouteDeps = {
    requireUserId,
    publishFlowDraft,
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
      // Publish can still resolve legacy preset: IDs into forks — stamp them
      // with the request's active-team scope, matching updateFlow.
      const flow = await deps.publishFlowDraft(
        userId,
        id,
        readActiveTeamIdHeader(request)
      );
      return NextResponse.json(flow);
    } catch (error) {
      if (isModelAllowlistUnavailableError(error)) {
        return NextResponse.json(
          { error: MODEL_ALLOWLIST_UNAVAILABLE_ERROR },
          {
            status: 503,
            headers: {
              "Retry-After": String(ALLOWLIST_UNAVAILABLE_RETRY_AFTER_SECONDS),
            },
          }
        );
      }
      const message =
        error instanceof Error ? error.message : "Failed to publish flow";
      if (isFlowServiceError(error)) {
        const payload = {
          error: message,
          code: error.code,
          ...(error.details ? { details: error.details } : {}),
        };
        return NextResponse.json(payload, {
          status: getFlowServiceErrorStatus(error),
        });
      }
      return NextResponse.json({ error: message }, { status: 500 });
    }
  };
}

export const POST = createFlowPublishPostHandler();
