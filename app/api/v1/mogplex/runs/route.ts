import { resolveApiKey } from "@/lib/auth/api-key";
import {
  MOGPLEX_API_MAX_IDEMPOTENCY_KEY_LENGTH,
  readMogplexApiIdempotencyKeyResult,
} from "@/lib/mogplex-api/request";
import {
  enforceExternalAgentRunLimits,
  type LimitDecision,
} from "@/lib/request-limits";
import {
  mogplexApiError,
  mogplexApiSuccess,
  resolveMogplexApiUser,
} from "@/lib/mogplex-api/response";
import { requireScope } from "@/lib/mogplex-api/scopes";
import { MogplexApiRunError, startMogplexApiRun } from "@/lib/mogplex-api/runs";
import type { NextRequest } from "next/server";

type MogplexApiRunsPostDeps = {
  resolveApiKey: typeof resolveApiKey;
  enforceRunStartLimits: typeof enforceExternalAgentRunLimits;
  startRun: typeof startMogplexApiRun;
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
    });
    if (!user.ok) return user.response;

    // Starting a run is a write op. Tokens issued before the scope migration
    // were backfilled to ['read','write'], so existing automation keeps
    // working; read-only tokens issued going forward will see 403 here.
    const forbidden = requireScope(user, "write");
    if (forbidden) return forbidden;

    const idempotencyKey = readMogplexApiIdempotencyKeyResult(request.headers);
    if (!idempotencyKey.ok) {
      if (idempotencyKey.error === "too_long") {
        return mogplexApiError(
          "BAD_REQUEST",
          `Idempotency-Key exceeds maximum length of ${MOGPLEX_API_MAX_IDEMPOTENCY_KEY_LENGTH} characters`,
          400
        );
      }
      return mogplexApiError("BAD_REQUEST", "Idempotency-Key is required", 400);
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return mogplexApiError("BAD_REQUEST", "Invalid JSON body", 400);
    }

    const repoId = typeof body.repoId === "string" ? body.repoId.trim() : null;
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
