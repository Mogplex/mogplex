import { resolveApiKey } from "@/lib/auth/api-key";
import { mogplexAutomationErrorResponse } from "@/lib/mogplex-api/automation-response";
import {
  createMogplexApiAutomation,
  listMogplexApiAutomations,
  MOGPLEX_API_DEFAULT_AUTOMATIONS_LIMIT,
  MOGPLEX_API_MAX_AUTOMATIONS_LIMIT,
  parseMogplexApiAutomationCursor,
} from "@/lib/mogplex-api/automations";
import { parseOptionalFlowGraph } from "@/lib/mogplex-api/automation-request";
import { parseMogplexApiListLimit } from "@/lib/mogplex-api/request";
import {
  mogplexApiError,
  mogplexApiSuccess,
  resolveMogplexApiUser,
} from "@/lib/mogplex-api/response";
import { requireScope } from "@/lib/mogplex-api/scopes";
import type { NextRequest } from "next/server";

type AutomationsRouteDeps = {
  resolveApiKey: typeof resolveApiKey;
  listAutomations: typeof listMogplexApiAutomations;
  createAutomation: typeof createMogplexApiAutomation;
};

const defaults: AutomationsRouteDeps = {
  resolveApiKey,
  listAutomations: listMogplexApiAutomations,
  createAutomation: createMogplexApiAutomation,
};

export function createMogplexApiAutomationsGetHandler(
  overrides: Partial<AutomationsRouteDeps> = {}
) {
  const deps = { ...defaults, ...overrides };
  return async function GET(request: NextRequest) {
    const user = await resolveMogplexApiUser(request, {
      resolveApiKey: deps.resolveApiKey,
    });
    if (!user.ok) return user.response;
    const forbidden = requireScope(user, "read");
    if (forbidden) return forbidden;

    const cursor = parseMogplexApiAutomationCursor(
      request.nextUrl.searchParams.get("cursor")
    );
    if (cursor === undefined) {
      return mogplexApiError("BAD_REQUEST", "Invalid cursor", 400);
    }
    const limit = parseMogplexApiListLimit(
      request.nextUrl.searchParams.get("limit"),
      {
        defaultLimit: MOGPLEX_API_DEFAULT_AUTOMATIONS_LIMIT,
        maxLimit: MOGPLEX_API_MAX_AUTOMATIONS_LIMIT,
      }
    );

    try {
      return mogplexApiSuccess(
        await deps.listAutomations(user.userId, { limit, cursor })
      );
    } catch (error) {
      return mogplexAutomationErrorResponse(
        error,
        "Failed to list automations"
      );
    }
  };
}

export function createMogplexApiAutomationsPostHandler(
  overrides: Partial<AutomationsRouteDeps> = {}
) {
  const deps = { ...defaults, ...overrides };
  return async function POST(request: NextRequest) {
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
      typeof installationId !== "number" ||
      !Number.isSafeInteger(installationId) ||
      installationId <= 0
    ) {
      return mogplexApiError(
        "BAD_REQUEST",
        "installationId must be a positive integer",
        400
      );
    }

    try {
      const automation = await deps.createAutomation(user.userId, {
        installationId,
        name: typeof body.name === "string" ? body.name : undefined,
        description:
          body.description === null || typeof body.description === "string"
            ? body.description
            : undefined,
        notes:
          body.notes === null || typeof body.notes === "string"
            ? body.notes
            : undefined,
        graph: parsedGraph.graph,
        publish: body.publish === true,
      });
      return mogplexApiSuccess({ automation }, { status: 201 });
    } catch (error) {
      return mogplexAutomationErrorResponse(
        error,
        "Failed to create automation"
      );
    }
  };
}

export const GET = createMogplexApiAutomationsGetHandler();
export const POST = createMogplexApiAutomationsPostHandler();
