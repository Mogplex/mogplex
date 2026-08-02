import { resolveApiKey } from "@/lib/auth/api-key";
import {
  mogplexApiError,
  mogplexApiSuccess,
  resolveMogplexApiUser,
} from "@/lib/mogplex-api/response";
import { requireScope } from "@/lib/mogplex-api/scopes";
import { getMogplexApiSandboxLogs } from "@/lib/mogplex-api/sandboxes";
import type { NextRequest } from "next/server";

export function createMogplexApiSandboxLogsGetHandler(
  overrides: {
    resolveApiKey?: typeof resolveApiKey;
    getLogs?: typeof getMogplexApiSandboxLogs;
  } = {}
) {
  const resolveKey = overrides.resolveApiKey ?? resolveApiKey;
  const getLogs = overrides.getLogs ?? getMogplexApiSandboxLogs;
  return async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ sandboxId: string }> }
  ) {
    const user = await resolveMogplexApiUser(request, {
      resolveApiKey: resolveKey,
    });
    if (!user.ok) return user.response;
    const forbidden = requireScope(user, "read");
    if (forbidden) return forbidden;
    try {
      const { sandboxId } = await params;
      const logs = await getLogs(user.userId, sandboxId);
      if (!logs) {
        return mogplexApiError("NOT_FOUND", "Sandbox not found", 404);
      }
      return mogplexApiSuccess(logs);
    } catch (error) {
      console.error("[mogplex-api/sandboxes] failed to load logs", error);
      return mogplexApiError(
        "INTERNAL_ERROR",
        "Failed to load sandbox logs",
        500
      );
    }
  };
}

export const GET = createMogplexApiSandboxLogsGetHandler();
