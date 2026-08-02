import { resolveApiKey } from "@/lib/auth/api-key";
import { mogplexAutomationErrorResponse } from "@/lib/mogplex-api/automation-response";
import {
  getMogplexApiAutomation,
  updateMogplexApiAutomation,
} from "@/lib/mogplex-api/automations";
import { parseOptionalFlowGraph } from "@/lib/mogplex-api/automation-request";
import {
  mogplexApiError,
  mogplexApiSuccess,
  resolveMogplexApiUser,
} from "@/lib/mogplex-api/response";
import { requireScope } from "@/lib/mogplex-api/scopes";
import type { NextRequest } from "next/server";

type AutomationItemDeps = {
  resolveApiKey: typeof resolveApiKey;
  getAutomation: typeof getMogplexApiAutomation;
  updateAutomation: typeof updateMogplexApiAutomation;
};

const defaults: AutomationItemDeps = {
  resolveApiKey,
  getAutomation: getMogplexApiAutomation,
  updateAutomation: updateMogplexApiAutomation,
};

export function createMogplexApiAutomationGetHandler(
  overrides: Partial<AutomationItemDeps> = {}
) {
  const deps = { ...defaults, ...overrides };
  return async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ automationId: string }> }
  ) {
    const user = await resolveMogplexApiUser(request, {
      resolveApiKey: deps.resolveApiKey,
    });
    if (!user.ok) return user.response;
    const forbidden = requireScope(user, "read");
    if (forbidden) return forbidden;
    try {
      const { automationId } = await params;
      return mogplexApiSuccess({
        automation: await deps.getAutomation(user.userId, automationId),
      });
    } catch (error) {
      return mogplexAutomationErrorResponse(error, "Failed to load automation");
    }
  };
}

export function createMogplexApiAutomationPutHandler(
  overrides: Partial<AutomationItemDeps> = {}
) {
  const deps = { ...defaults, ...overrides };
  return async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ automationId: string }> }
  ) {
    const user = await resolveMogplexApiUser(request, {
      resolveApiKey: deps.resolveApiKey,
    });
    if (!user.ok) return user.response;
    const forbidden = requireScope(user, "write");
    if (forbidden) return forbidden;
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body) {
      return mogplexApiError("BAD_REQUEST", "Invalid JSON body", 400);
    }
    const parsedGraph = parseOptionalFlowGraph(body);
    if (!parsedGraph.ok) {
      return mogplexApiError("BAD_REQUEST", parsedGraph.message, 400);
    }
    const installationId = body.installationId;
    if (
      installationId !== undefined &&
      (typeof installationId !== "number" ||
        !Number.isSafeInteger(installationId) ||
        installationId <= 0)
    ) {
      return mogplexApiError(
        "BAD_REQUEST",
        "installationId must be a positive integer",
        400
      );
    }
    try {
      const { automationId } = await params;
      const automation = await deps.updateAutomation(
        user.userId,
        automationId,
        {
          name: typeof body.name === "string" ? body.name : undefined,
          description:
            body.description === null || typeof body.description === "string"
              ? body.description
              : undefined,
          notes:
            body.notes === null || typeof body.notes === "string"
              ? body.notes
              : undefined,
          installationId,
          graph: parsedGraph.graph,
        }
      );
      return mogplexApiSuccess({ automation });
    } catch (error) {
      return mogplexAutomationErrorResponse(
        error,
        "Failed to update automation"
      );
    }
  };
}

export const GET = createMogplexApiAutomationGetHandler();
export const PUT = createMogplexApiAutomationPutHandler();
