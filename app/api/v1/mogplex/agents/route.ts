import { resolveApiKey } from "@/lib/auth/api-key";
import { listMogplexApiAgents } from "@/lib/mogplex-api/agents";
import {
  mogplexApiError,
  mogplexApiSuccess,
  resolveMogplexApiUser,
} from "@/lib/mogplex-api/response";
import { requireScope } from "@/lib/mogplex-api/scopes";
import type { NextRequest } from "next/server";

export function createMogplexApiAgentsGetHandler(
  overrides: {
    resolveApiKey?: typeof resolveApiKey;
    listAgents?: typeof listMogplexApiAgents;
  } = {}
) {
  const resolveKey = overrides.resolveApiKey ?? resolveApiKey;
  const listAgents = overrides.listAgents ?? listMogplexApiAgents;
  return async function GET(request: NextRequest) {
    const user = await resolveMogplexApiUser(request, {
      resolveApiKey: resolveKey,
    });
    if (!user.ok) return user.response;
    const forbidden = requireScope(user, "read");
    if (forbidden) return forbidden;
    try {
      return mogplexApiSuccess({ agents: await listAgents(user.userId) });
    } catch (error) {
      console.error("[mogplex-api/agents] failed to list agents", error);
      return mogplexApiError("INTERNAL_ERROR", "Failed to list agents", 500);
    }
  };
}

export const GET = createMogplexApiAgentsGetHandler();
