import { resolveApiKey } from "@/lib/auth/api-key";
import { listMogplexApiModels } from "@/lib/mogplex-api/models";
import {
  mogplexApiError,
  mogplexApiSuccess,
  resolveMogplexApiUser,
} from "@/lib/mogplex-api/response";
import { requireScope } from "@/lib/mogplex-api/scopes";
import type { NextRequest } from "next/server";

export function createMogplexApiModelsGetHandler(
  overrides: {
    resolveApiKey?: typeof resolveApiKey;
    listModels?: typeof listMogplexApiModels;
  } = {}
) {
  const resolveKey = overrides.resolveApiKey ?? resolveApiKey;
  const listModels = overrides.listModels ?? listMogplexApiModels;
  return async function GET(request: NextRequest) {
    const user = await resolveMogplexApiUser(request, {
      resolveApiKey: resolveKey,
    });
    if (!user.ok) return user.response;
    const forbidden = requireScope(user, "read");
    if (forbidden) return forbidden;
    try {
      return mogplexApiSuccess({ models: await listModels(user.userId) });
    } catch (error) {
      console.error("[mogplex-api/models] failed to list models", error);
      return mogplexApiError("INTERNAL_ERROR", "Failed to list models", 500);
    }
  };
}

export const GET = createMogplexApiModelsGetHandler();
