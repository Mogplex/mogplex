import { resolveApiKey } from "@/lib/auth/api-key";
import { validateFlowConfiguration } from "@/lib/flows/server-validation";
import { mogplexAutomationErrorResponse } from "@/lib/mogplex-api/automation-response";
import { coerceGraph } from "@/lib/flows/graph";
import { validateAutomationArgsSchema } from "@/lib/mogplex-api/mcp-schemas";
import {
  mogplexApiError,
  mogplexApiSuccess,
  resolveMogplexApiUser,
} from "@/lib/mogplex-api/response";
import { requireScope } from "@/lib/mogplex-api/scopes";
import type { NextRequest } from "next/server";

export function createAutomationValidateHandler(
  overrides: {
    resolveApiKey?: typeof resolveApiKey;
    validate?: typeof validateFlowConfiguration;
  } = {}
) {
  return async function POST(request: NextRequest) {
    const user = await resolveMogplexApiUser(request, {
      resolveApiKey: overrides.resolveApiKey ?? resolveApiKey,
    });
    if (!user.ok) return user.response;
    const forbidden = requireScope(user, "read");
    if (forbidden) return forbidden;
    const parsed = validateAutomationArgsSchema.safeParse(
      await request.json().catch(() => null)
    );
    if (!parsed.success) {
      return mogplexApiError(
        "BAD_REQUEST",
        parsed.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; "),
        400
      );
    }
    try {
      const validation = await (
        overrides.validate ?? validateFlowConfiguration
      )(
        user.userId,
        coerceGraph(parsed.data.graph),
        parsed.data.installationId
      );
      return mogplexApiSuccess({ validation });
    } catch (error) {
      return mogplexAutomationErrorResponse(
        error,
        "Could not validate automation configuration"
      );
    }
  };
}

export const POST = createAutomationValidateHandler();
