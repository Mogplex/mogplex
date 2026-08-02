import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import {
  getFlowServiceErrorStatus,
  isFlowServiceError,
} from "@/lib/flows/errors";
import {
  generateFlowAssistantSuggestion,
  loadOwnedFlow,
} from "@/lib/flows/api";
import { coerceGraph, validateFlowGraph } from "@/lib/flows/graph";
import {
  ALLOWLIST_UNAVAILABLE_RETRY_AFTER_SECONDS,
  isModelAllowlistUnavailableError,
  readActiveTeamIdHeader,
  resolveActiveTeamCapabilities,
} from "@/lib/team-capabilities";

export const maxDuration = 60;

type FlowAssistantRouteDeps = {
  requireUserId: typeof requireUserId;
  loadOwnedFlow: typeof loadOwnedFlow;
  generateFlowAssistantSuggestion: typeof generateFlowAssistantSuggestion;
  resolveActiveTeamCapabilities: typeof resolveActiveTeamCapabilities;
};

export function createFlowAssistantPostHandler(
  overrides: Partial<FlowAssistantRouteDeps> = {}
) {
  const deps: FlowAssistantRouteDeps = {
    requireUserId,
    loadOwnedFlow,
    generateFlowAssistantSuggestion,
    resolveActiveTeamCapabilities,
    ...overrides,
  };

  return async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
  ) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    const { id } = await params;
    const flow = await deps.loadOwnedFlow(userId, id);
    if (!flow) {
      return NextResponse.json({ error: "Flow not found" }, { status: 404 });
    }

    const body = await request.json();
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) {
      return NextResponse.json(
        { error: "message is required" },
        { status: 400 }
      );
    }

    const activeTeam = await deps.resolveActiveTeamCapabilities(
      userId,
      readActiveTeamIdHeader(request)
    );
    if (!activeTeam.ok) {
      return NextResponse.json(
        { error: activeTeam.error },
        { status: activeTeam.status }
      );
    }

    try {
      const graph = body.graph ? coerceGraph(body.graph) : flow.draft_graph;
      const suggestion = await deps.generateFlowAssistantSuggestion({
        userId,
        flowId: id,
        teamId: activeTeam.teamId,
        capabilities: activeTeam.capabilities,
        message,
        graph,
      });
      const validation = validateFlowGraph(suggestion.graph, {
        requireRunnableConfig: true,
      });
      if (!validation.valid) {
        return NextResponse.json(
          {
            error: "Assistant produced an invalid flow graph",
            code: "FLOW_ASSISTANT_INVALID_GRAPH",
            details: validation.errors,
          },
          { status: 400 }
        );
      }

      return NextResponse.json(suggestion);
    } catch (error) {
      console.error("[flow-assistant]", error);
      const message =
        error instanceof Error
          ? error.message
          : "Failed to generate flow suggestion";
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
      // The flow assistant resolves under team scope, so it can hit the
      // allowlist gate. 503 + Retry-After like every other resolver surface:
      // the failure is transient and a 500 would read as a bug.
      if (isModelAllowlistUnavailableError(error)) {
        return NextResponse.json(
          { error: message },
          {
            status: 503,
            headers: {
              "Retry-After": String(ALLOWLIST_UNAVAILABLE_RETRY_AFTER_SECONDS),
            },
          }
        );
      }
      return NextResponse.json({ error: message }, { status: 500 });
    }
  };
}

export const POST = createFlowAssistantPostHandler();
