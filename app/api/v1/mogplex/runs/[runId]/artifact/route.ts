import { resolveApiKey } from "@/lib/auth/api-key";
import {
  mogplexApiError,
  mogplexApiSuccess,
  resolveMogplexApiUser,
} from "@/lib/mogplex-api/response";
import {
  loadRunArtifact,
  RunArtifactError,
  runArtifactPathSchema,
} from "@/lib/mogplex-api/run-artifacts";

export function createRunArtifactGetHandler(
  overrides: {
    resolveApiKey?: typeof resolveApiKey;
    loadArtifact?: typeof loadRunArtifact;
  } = {}
) {
  return async function GET(
    request: Request,
    context: { params: Promise<{ runId: string }> }
  ) {
    const user = await resolveMogplexApiUser(request, {
      resolveApiKey: overrides.resolveApiKey,
    });
    if (!user.ok) return user.response;
    const path = runArtifactPathSchema.safeParse(
      new URL(request.url).searchParams.get("path")
    );
    if (!path.success)
      return mogplexApiError(
        "BAD_REQUEST",
        "Use a JSON file in .mogplex/artifacts",
        400
      );
    const { runId } = await context.params;
    try {
      const artifact = await (overrides.loadArtifact ?? loadRunArtifact)({
        userId: user.userId,
        runId,
        path: path.data,
      });
      return mogplexApiSuccess(
        { artifact },
        { headers: { "Cache-Control": "private, no-store" } }
      );
    } catch (error) {
      if (error instanceof RunArtifactError) {
        const codes = {
          400: "BAD_REQUEST",
          404: "NOT_FOUND",
          409: "CONFLICT",
          502: "SERVICE_UNAVAILABLE",
        } as const;
        return mogplexApiError(
          codes[error.status],
          error.message,
          error.status
        );
      }
      console.error("[mogplex-api/artifact] Could not read artifact", {
        runId,
      });
      return mogplexApiError("INTERNAL_ERROR", "Could not read artifact", 500);
    }
  };
}

export const GET = createRunArtifactGetHandler();
