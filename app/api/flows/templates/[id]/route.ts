import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { deleteFlowTemplate } from "@/lib/flows/api";
import {
  resolveActiveTeamCapabilities,
  TEAM_RESOURCE_WRITE_CAPABILITY,
} from "@/lib/team-capabilities";
import { resolveProductResourceScope } from "@/lib/team-resource-scope";

type FlowTemplateRouteDeps = {
  requireUserId: typeof requireUserId;
  resolveActiveTeamCapabilities: typeof resolveActiveTeamCapabilities;
  deleteFlowTemplate: typeof deleteFlowTemplate;
};

export function createFlowTemplateDeleteHandler(
  overrides: Partial<FlowTemplateRouteDeps> = {}
) {
  const deps: FlowTemplateRouteDeps = {
    requireUserId,
    resolveActiveTeamCapabilities,
    deleteFlowTemplate,
    ...overrides,
  };

  return async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
  ) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    const scopeResolution = await resolveProductResourceScope({
      request,
      userId,
      requiredCapability: TEAM_RESOURCE_WRITE_CAPABILITY,
      resolveActiveTeamCapabilities: deps.resolveActiveTeamCapabilities,
    });
    if (!scopeResolution.ok) {
      return NextResponse.json(
        { error: scopeResolution.error },
        { status: scopeResolution.status }
      );
    }

    const { id } = await params;
    try {
      const deleted = await deps.deleteFlowTemplate(scopeResolution.scope, id);
      if (!deleted) {
        return NextResponse.json(
          { error: "Workflow template not found" },
          { status: 404 }
        );
      }
      return NextResponse.json({ ok: true });
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Failed to delete workflow template",
        },
        { status: 500 }
      );
    }
  };
}

export const DELETE = createFlowTemplateDeleteHandler();
