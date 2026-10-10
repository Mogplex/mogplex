import { resolveApiKey } from "@/lib/auth/api-key";
import type { resolveMogplexOAuthToken } from "@/lib/auth/mogplex-oauth";
import { requireMogplexApiIdempotencyKey } from "@/lib/mogplex-api/request";
import {
  enforceExternalAgentRunLimits,
  type LimitDecision,
} from "@/lib/request-limits";
import {
  mogplexApiError,
  mogplexApiSuccess,
  resolveMogplexApiUser,
} from "@/lib/mogplex-api/response";
import { requireFullAccessKey } from "@/lib/mogplex-api/credential-boundary";
import {
  requireKeyAllowedOn,
  type LoadTeamKeyAccess,
} from "@/lib/mogplex-api/team-key-access";
import { requireScope } from "@/lib/mogplex-api/scopes";
import { MogplexApiRunError, startMogplexApiRun } from "@/lib/mogplex-api/runs";
import type { NextRequest } from "next/server";

type MogplexApiRunsPostDeps = {
  resolveApiKey: typeof resolveApiKey;
  /** Test seam for OAuth (interactive) bearer tokens. */
  resolveOAuthToken?: typeof resolveMogplexOAuthToken;
  enforceRunStartLimits: typeof enforceExternalAgentRunLimits;
  startRun: typeof startMogplexApiRun;
  /** Test seam for the repository's team key access. */
  loadTeamKeyAccess?: LoadTeamKeyAccess;
};

const defaultMogplexApiRunsPostDeps: MogplexApiRunsPostDeps = {
  resolveApiKey,
  enforceRunStartLimits: enforceExternalAgentRunLimits,
  startRun: startMogplexApiRun,
};

function toRunErrorResponse(error: unknown) {
  if (error instanceof MogplexApiRunError) {
    return mogplexApiError(error.code, error.message, error.status);
  }

  console.error("[mogplex-api/runs] failed to start run", error);
  return mogplexApiError("INTERNAL_ERROR", "Failed to start run", 500);
}

function toRateLimitResponse(
  decision: Extract<LimitDecision, { allowed: false }>
) {
  const response = mogplexApiError("RATE_LIMITED", decision.error, 429);
  response.headers.set("Retry-After", String(decision.retryAfterSeconds));
  return response;
}

function toRateLimitUnavailableResponse(error: unknown) {
  console.error("[mogplex-api/runs] rate limit check failed", error);
  const response = mogplexApiError(
    "SERVICE_UNAVAILABLE",
    "External Mogplex run rate limit unavailable",
    503
  );
  response.headers.set("Retry-After", "60");
  return response;
}

export function createMogplexApiRunsPostHandler(
  overrides: Partial<MogplexApiRunsPostDeps> = {}
) {
  const deps: MogplexApiRunsPostDeps = {
    ...defaultMogplexApiRunsPostDeps,
    ...overrides,
  };

  return async function POST(request: NextRequest) {
    const user = await resolveMogplexApiUser(request, {
      resolveApiKey: deps.resolveApiKey,
      resolveOAuthToken: deps.resolveOAuthToken,
    });
    if (!user.ok) return user.response;

    // Starting a run is a write op. Tokens issued before the scope migration
    // were backfilled to ['read','write'], so existing automation keeps
    // working; read-only tokens issued going forward will see 403 here.
    const forbidden = requireScope(user, "write");
    if (forbidden) return forbidden;
    const restricted = requireFullAccessKey(user);
    if (restricted) return restricted;

    const idempotencyKey = requireMogplexApiIdempotencyKey(request.headers);
    if (!idempotencyKey.ok) return idempotencyKey.response;

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return mogplexApiError("BAD_REQUEST", "Invalid JSON body", 400);
    }

    const repoId = typeof body.repoId === "string" ? body.repoId.trim() : null;
    if (repoId) {
      const teamRefusal = await requireKeyAllowedOn(
        user,
        { repoId },
        deps.loadTeamKeyAccess
      );
      if (teamRefusal) return teamRefusal;
    }
    let limitDecision: LimitDecision;
    try {
      limitDecision = await deps.enforceRunStartLimits({
        userId: user.userId,
        apiKeyId: user.keyId,
        repoId,
      });
    } catch (error) {
      return toRateLimitUnavailableResponse(error);
    }
    if (!limitDecision.allowed) {
      return toRateLimitResponse(limitDecision);
    }

    try {
      const { run, replayed } = await deps.startRun({
        user,
        idempotencyKey: idempotencyKey.value,
        body,
      });
      return mogplexApiSuccess({ ...run, replayed }, { status: 202 });
    } catch (error) {
      return toRunErrorResponse(error);
    }
  };
}

export const POST = createMogplexApiRunsPostHandler();
