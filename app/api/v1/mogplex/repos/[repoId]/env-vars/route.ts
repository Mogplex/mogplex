import { z } from "zod";
import { resolveApiKey } from "@/lib/auth/api-key";
import {
  deleteMogplexApiRepoEnvVar,
  listMogplexApiRepoEnvVars,
  upsertMogplexApiRepoEnvVar,
} from "@/lib/mogplex-api/env-vars";
import {
  mogplexApiError,
  mogplexApiSuccess,
  resolveMogplexApiUser,
} from "@/lib/mogplex-api/response";
import { requireScope } from "@/lib/mogplex-api/scopes";
import type { MogplexApiEnvVarError } from "@/lib/mogplex-api/env-vars";
import type { NextRequest } from "next/server";

type RouteContext = { params: Promise<{ repoId: string }> };

type EnvVarRouteDeps = {
  resolveApiKey: typeof resolveApiKey;
  listEnvVars: typeof listMogplexApiRepoEnvVars;
  upsertEnvVar: typeof upsertMogplexApiRepoEnvVar;
  deleteEnvVar: typeof deleteMogplexApiRepoEnvVar;
};

const defaultDeps: EnvVarRouteDeps = {
  resolveApiKey,
  listEnvVars: listMogplexApiRepoEnvVars,
  upsertEnvVar: upsertMogplexApiRepoEnvVar,
  deleteEnvVar: deleteMogplexApiRepoEnvVar,
};

const ENV_VAR_TARGETS = ["production", "preview", "development"] as const;

const upsertBodySchema = z
  .object({
    key: z
      .string()
      .trim()
      .min(1)
      .max(256)
      .regex(
        /^[A-Za-z_]\w*$/,
        "key must contain only letters, digits, and underscores and not start with a digit"
      ),
    value: z.string().max(65_536),
    target: z.array(z.enum(ENV_VAR_TARGETS)).min(1).optional(),
    type: z.enum(["encrypted", "plain", "sensitive"]).optional(),
  })
  .strict();

const deleteBodySchema = z
  .object({
    key: z.string().trim().min(1).max(256),
  })
  .strict();

function envVarErrorResponse(error: MogplexApiEnvVarError) {
  return mogplexApiError(error.code, error.message, error.status);
}

async function parseBody<T extends z.ZodTypeAny>(
  request: NextRequest,
  schema: T
): Promise<{ ok: true; body: z.infer<T> } | { ok: false; response: Response }> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return {
      ok: false,
      response: mogplexApiError("BAD_REQUEST", "Invalid JSON body", 400),
    };
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      response: mogplexApiError(
        "BAD_REQUEST",
        parsed.error.issues
          .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
          .join("; "),
        400
      ),
    };
  }

  return { ok: true, body: parsed.data };
}

export function createMogplexApiRepoEnvVarsGetHandler(
  overrides: Partial<EnvVarRouteDeps> = {}
) {
  const deps = { ...defaultDeps, ...overrides };

  return async function GET(request: NextRequest, ctx: RouteContext) {
    const user = await resolveMogplexApiUser(request, {
      resolveApiKey: deps.resolveApiKey,
    });
    if (!user.ok) return user.response;
    const forbidden = requireScope(user, "read");
    if (forbidden) return forbidden;

    try {
      const { repoId } = await ctx.params;
      const result = await deps.listEnvVars(user.userId, repoId);
      if (!result.ok) return envVarErrorResponse(result.error);
      return mogplexApiSuccess(result.data);
    } catch (error) {
      console.error("[mogplex-api/env-vars] failed to list env vars", error);
      return mogplexApiError("INTERNAL_ERROR", "Failed to list env vars", 500);
    }
  };
}

export function createMogplexApiRepoEnvVarsPostHandler(
  overrides: Partial<EnvVarRouteDeps> = {}
) {
  const deps = { ...defaultDeps, ...overrides };

  return async function POST(request: NextRequest, ctx: RouteContext) {
    const user = await resolveMogplexApiUser(request, {
      resolveApiKey: deps.resolveApiKey,
    });
    if (!user.ok) return user.response;
    const forbidden = requireScope(user, "write");
    if (forbidden) return forbidden;

    const parsed = await parseBody(request, upsertBodySchema);
    if (!parsed.ok) return parsed.response;

    try {
      const { repoId } = await ctx.params;
      const result = await deps.upsertEnvVar(user.userId, repoId, parsed.body);
      if (!result.ok) return envVarErrorResponse(result.error);
      return mogplexApiSuccess(result.data);
    } catch (error) {
      console.error("[mogplex-api/env-vars] failed to upsert env var", error);
      return mogplexApiError("INTERNAL_ERROR", "Failed to set env var", 500);
    }
  };
}

export function createMogplexApiRepoEnvVarsDeleteHandler(
  overrides: Partial<EnvVarRouteDeps> = {}
) {
  const deps = { ...defaultDeps, ...overrides };

  return async function DELETE(request: NextRequest, ctx: RouteContext) {
    const user = await resolveMogplexApiUser(request, {
      resolveApiKey: deps.resolveApiKey,
    });
    if (!user.ok) return user.response;
    const forbidden = requireScope(user, "write");
    if (forbidden) return forbidden;

    const parsed = await parseBody(request, deleteBodySchema);
    if (!parsed.ok) return parsed.response;

    try {
      const { repoId } = await ctx.params;
      const result = await deps.deleteEnvVar(user.userId, repoId, parsed.body);
      if (!result.ok) return envVarErrorResponse(result.error);
      return mogplexApiSuccess(result.data);
    } catch (error) {
      console.error("[mogplex-api/env-vars] failed to delete env var", error);
      return mogplexApiError("INTERNAL_ERROR", "Failed to delete env var", 500);
    }
  };
}

export const GET = createMogplexApiRepoEnvVarsGetHandler();
export const POST = createMogplexApiRepoEnvVarsPostHandler();
export const DELETE = createMogplexApiRepoEnvVarsDeleteHandler();
