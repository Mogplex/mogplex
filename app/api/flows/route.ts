import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import {
  getFlowServiceErrorStatus,
  isFlowServiceError,
} from "@/lib/flows/errors";
import {
  createFlowForUser,
  listOwnedFlowsWithSummaries,
} from "@/lib/flows/api";
import {
  isFlowStarterTemplateId,
  type FlowStarterTemplateId,
} from "@/lib/flows/templates";
import { resolveActiveTeamCapabilities } from "@/lib/team-capabilities";
import { resolveProductResourceScope } from "@/lib/team-resource-scope";

function optionalString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function readTemplateId(
  value: unknown
): FlowStarterTemplateId | null | undefined {
  if (value == null) return null;
  return isFlowStarterTemplateId(value) ? value : undefined;
}

type FlowsRouteDeps = {
  requireUserId: typeof requireUserId;
  listOwnedFlowsWithSummaries: typeof listOwnedFlowsWithSummaries;
  createFlowForUser: typeof createFlowForUser;
  resolveActiveTeamCapabilities: typeof resolveActiveTeamCapabilities;
};

export function createFlowsGetHandler(overrides: Partial<FlowsRouteDeps> = {}) {
  const deps: FlowsRouteDeps = {
    requireUserId,
    listOwnedFlowsWithSummaries,
    createFlowForUser,
    resolveActiveTeamCapabilities,
    ...overrides,
  };

  return async function GET() {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    try {
      const flows = await deps.listOwnedFlowsWithSummaries(userId);
      return NextResponse.json(flows);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load flows";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  };
}

export function createFlowsPostHandler(
  overrides: Partial<FlowsRouteDeps> = {}
) {
  const deps: FlowsRouteDeps = {
    requireUserId,
    listOwnedFlowsWithSummaries,
    createFlowForUser,
    resolveActiveTeamCapabilities,
    ...overrides,
  };

  return async function POST(request: Request) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    const body = await request.json();
    const installationId = Number(body.installation_id);
    const name = optionalString(body.name);
    const templateId = readTemplateId(body.template_id);
    const personalTemplateId = optionalString(body.personal_template_id);
    const teamTemplateId = optionalString(body.team_template_id);
    const repository = optionalString(body.repo_full_name);

    if (!Number.isFinite(installationId) || installationId <= 0) {
      return NextResponse.json(
        { error: "installation_id is required" },
        { status: 400 }
      );
    }
    if (templateId === undefined) {
      return NextResponse.json(
        { error: "Unknown workflow template" },
        { status: 400 }
      );
    }
    const templateChoiceCount = [
      templateId,
      personalTemplateId,
      teamTemplateId,
    ].filter(Boolean).length;
    if (templateChoiceCount > 1) {
      return NextResponse.json(
        { error: "Choose one workflow template" },
        { status: 400 }
      );
    }

    try {
      let teamId: string | null = null;
      if (teamTemplateId) {
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
        if (scopeResolution.scope.kind !== "team") {
          return NextResponse.json(
            { error: "Team workflow template requires an active team" },
            { status: 400 }
          );
        }
        teamId = scopeResolution.scope.productTeamId;
      }

      const created = await deps.createFlowForUser({
        userId,
        installationId,
        name,
        templateId,
        personalTemplateId,
        teamTemplateId,
        teamId,
        repository,
      });
      return NextResponse.json(created, { status: 201 });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to create flow";
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

export const GET = createFlowsGetHandler();
export const POST = createFlowsPostHandler();
