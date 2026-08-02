import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import {
  getFlowServiceErrorStatus,
  isFlowServiceError,
} from "@/lib/flows/errors";
import { createFlowTemplate, listFlowTemplates } from "@/lib/flows/api";
import {
  hasCapability,
  resolveActiveTeamCapabilities,
  TEAM_RESOURCE_WRITE_CAPABILITY,
} from "@/lib/team-capabilities";
import { resolveProductResourceScope } from "@/lib/team-resource-scope";

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

type FlowTemplatesRouteDeps = {
  requireUserId: typeof requireUserId;
  resolveActiveTeamCapabilities: typeof resolveActiveTeamCapabilities;
  createFlowTemplate: typeof createFlowTemplate;
  listFlowTemplates: typeof listFlowTemplates;
};

export function createFlowTemplatesGetHandler(
  overrides: Partial<FlowTemplatesRouteDeps> = {}
) {
  const deps: FlowTemplatesRouteDeps = {
    requireUserId,
    resolveActiveTeamCapabilities,
    createFlowTemplate,
    listFlowTemplates,
    ...overrides,
  };

  return async function GET(request: Request) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    const scopeResolution = await resolveProductResourceScope({
      request,
      userId,
      resolveActiveTeamCapabilities: deps.resolveActiveTeamCapabilities,
    });
    if (!scopeResolution.ok) {
      return NextResponse.json(
        { error: scopeResolution.error },
        { status: scopeResolution.status }
      );
    }

    const cursorValue = new URL(request.url).searchParams.get("cursor");
    const cursor = cursorValue === null ? 0 : Number(cursorValue);
    if (
      cursorValue !== null &&
      (!Number.isSafeInteger(cursor) ||
        cursor < 0 ||
        String(cursor) !== cursorValue)
    ) {
      return NextResponse.json(
        { error: "cursor must be a non-negative integer" },
        { status: 400 }
      );
    }

    try {
      const page = await deps.listFlowTemplates(scopeResolution.scope, cursor);
      return NextResponse.json(
        scopeResolution.scope.kind === "team"
          ? {
              ...page,
              can_write: hasCapability(
                scopeResolution.capabilities ?? new Set(),
                TEAM_RESOURCE_WRITE_CAPABILITY
              ),
            }
          : page
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to load workflow templates";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  };
}

export function createFlowTemplatesPostHandler(
  overrides: Partial<FlowTemplatesRouteDeps> = {}
) {
  const deps: FlowTemplatesRouteDeps = {
    requireUserId,
    resolveActiveTeamCapabilities,
    createFlowTemplate,
    listFlowTemplates,
    ...overrides,
  };

  return async function POST(request: Request) {
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

    const body = await request.json();
    const flowId = optionalString(body.flow_id);
    const name = optionalString(body.name);
    if (!flowId) {
      return NextResponse.json(
        { error: "flow_id is required" },
        { status: 400 }
      );
    }
    if (name && name.length > 80) {
      return NextResponse.json(
        { error: "Template names must be 80 characters or fewer" },
        { status: 400 }
      );
    }

    try {
      const template = await deps.createFlowTemplate({
        userId,
        flowId,
        name,
        scope: scopeResolution.scope,
      });
      return NextResponse.json(template, { status: 201 });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to save workflow template";
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

export const GET = createFlowTemplatesGetHandler();
export const POST = createFlowTemplatesPostHandler();
