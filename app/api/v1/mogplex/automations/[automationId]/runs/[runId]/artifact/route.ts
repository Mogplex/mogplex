import { z } from "zod";
import { resolveApiKey } from "@/lib/auth/api-key";
import { loadAutomationRunArtifact } from "@/lib/mogplex-api/automation-run-artifacts";
import {
  mogplexApiError,
  mogplexApiSuccess,
  resolveMogplexApiUser,
} from "@/lib/mogplex-api/response";
import { runArtifactErrorResponse } from "@/lib/mogplex-api/run-artifact-response";
import { runArtifactPathSchema } from "@/lib/mogplex-api/run-artifacts";
import { requireScope } from "@/lib/mogplex-api/scopes";

const paramsSchema = z.object({
  automationId: z.string().uuid(),
  runId: z.string().uuid(),
});

export function createAutomationRunArtifactGetHandler(
  overrides: {
    resolveApiKey?: typeof resolveApiKey;
    loadArtifact?: typeof loadAutomationRunArtifact;
  } = {}
) {
  return async function GET(
    request: Request,
    context: { params: Promise<{ automationId: string; runId: string }> }
  ) {
    const user = await resolveMogplexApiUser(request, {
      resolveApiKey: overrides.resolveApiKey ?? resolveApiKey,
    });
    if (!user.ok) return user.response;
    const forbidden = requireScope(user, "read");
    if (forbidden) return forbidden;
    const params = paramsSchema.safeParse(await context.params);
    if (!params.success)
      return mogplexApiError(
        "BAD_REQUEST",
        "automationId and runId must be UUIDs",
        400
      );
    const path = runArtifactPathSchema.safeParse(
      new URL(request.url).searchParams.get("path")
    );
    if (!path.success)
      return mogplexApiError(
        "BAD_REQUEST",
        "Use a JSON file in .mogplex/artifacts",
        400
      );
    const { automationId, runId } = params.data;
    try {
      const artifact = await (
        overrides.loadArtifact ?? loadAutomationRunArtifact
      )({
        userId: user.userId,
        automationId,
        jobRunId: runId,
        path: path.data,
      });
      return mogplexApiSuccess(
        { artifact },
        { headers: { "Cache-Control": "private, no-store" } }
      );
    } catch (error) {
      return runArtifactErrorResponse(error, { automationId, runId });
    }
  };
}

export const GET = createAutomationRunArtifactGetHandler();
