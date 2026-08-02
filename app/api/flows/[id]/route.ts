import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import {
  getFlowServiceErrorStatus,
  isFlowServiceError,
} from "@/lib/flows/errors";
import { coerceGraph } from "@/lib/flows/graph";
import { readActiveTeamIdHeader } from "@/lib/team-capabilities";
import {
  deleteFlow,
  loadOwnedFlow,
  syncFlowActivation,
  updateFlow,
} from "@/lib/flows/api";

type FlowRouteDeps = {
  requireUserId: typeof requireUserId;
  loadOwnedFlow: typeof loadOwnedFlow;
  updateFlow: typeof updateFlow;
  syncFlowActivation: typeof syncFlowActivation;
  deleteFlow: typeof deleteFlow;
};

export function createFlowGetHandler(overrides: Partial<FlowRouteDeps> = {}) {
  const deps: FlowRouteDeps = {
    requireUserId,
    loadOwnedFlow,
    updateFlow,
    syncFlowActivation,
    deleteFlow,
    ...overrides,
  };

  return async function GET(
    _request: Request,
    { params }: { params: Promise<{ id: string }> }
  ) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    const { id } = await params;
    const flow = await deps.loadOwnedFlow(userId, id);
    if (!flow) {
      return NextResponse.json({ error: "Flow not found" }, { status: 404 });
    }

    return NextResponse.json(flow);
  };
}

export function createFlowPutHandler(overrides: Partial<FlowRouteDeps> = {}) {
  const deps: FlowRouteDeps = {
    requireUserId,
    loadOwnedFlow,
    updateFlow,
    syncFlowActivation,
    deleteFlow,
    ...overrides,
  };

  return async function PUT(
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

    if ("status" in body) {
      const status =
        body.status === "active"
          ? "active"
          : body.status === "inactive"
            ? "inactive"
            : null;
      if (!status) {
        return NextResponse.json({ error: "Invalid status" }, { status: 400 });
      }

      try {
        const updated = await deps.syncFlowActivation(userId, id, status);
        return NextResponse.json(updated);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to update flow status";
        if (isFlowServiceError(error)) {
          return NextResponse.json(
            { error: message, code: error.code },
            { status: getFlowServiceErrorStatus(error) }
          );
        }
        return NextResponse.json({ error: message }, { status: 500 });
      }
    }

    try {
      const updated = await deps.updateFlow({
        userId,
        flowId: id,
        name: typeof body.name === "string" ? body.name : undefined,
        description:
          "description" in body
            ? typeof body.description === "string"
              ? body.description
              : null
            : undefined,
        notes:
          "notes" in body
            ? typeof body.notes === "string"
              ? body.notes
              : null
            : undefined,
        installationId:
          "installation_id" in body ? Number(body.installation_id) : undefined,
        draftGraph:
          "draft_graph" in body ? coerceGraph(body.draft_graph) : undefined,
        // Preset fork stamping must use the same scope the UI displayed the
        // preset model under — see resolveStoredUserDefaultModelId.
        teamId: readActiveTeamIdHeader(request),
      });
      return NextResponse.json(updated);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to update flow";
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

export function createFlowDeleteHandler(
  overrides: Partial<FlowRouteDeps> = {}
) {
  const deps: FlowRouteDeps = {
    requireUserId,
    loadOwnedFlow,
    updateFlow,
    syncFlowActivation,
    deleteFlow,
    ...overrides,
  };

  return async function DELETE(
    _request: Request,
    { params }: { params: Promise<{ id: string }> }
  ) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    const { id } = await params;
    const flow = await deps.loadOwnedFlow(userId, id);
    if (!flow) {
      return NextResponse.json({ error: "Flow not found" }, { status: 404 });
    }

    try {
      await deps.deleteFlow(userId, id);
      return NextResponse.json({ ok: true });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to delete flow";
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

export const GET = createFlowGetHandler();
export const PUT = createFlowPutHandler();
export const DELETE = createFlowDeleteHandler();
