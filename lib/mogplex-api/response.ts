import { NextResponse } from "next/server";
import {
  API_KEY_RATE_LIMIT_WINDOW_SECONDS,
  resolveApiKey,
} from "@/lib/auth/api-key";
import { resolveMogplexOAuthToken } from "@/lib/auth/mogplex-oauth";
import { buildMogplexMcpBearerChallenge } from "@/lib/mogplex-api/oauth-config";

export type MogplexApiErrorCode =
  | "BAD_REQUEST"
  | "CONFLICT"
  | "FORBIDDEN"
  | "IDEMPOTENCY_CONFLICT"
  | "INTERNAL_ERROR"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "SERVICE_UNAVAILABLE"
  | "UNAUTHORIZED";

export type MogplexApiErrorBody = {
  ok: false;
  error: {
    code: MogplexApiErrorCode;
    message: string;
  };
};

export type MogplexApiSuccessBody<T> = {
  ok: true;
  data: T;
};

export function mogplexApiSuccess<T>(
  data: T,
  init?: ResponseInit
): NextResponse<MogplexApiSuccessBody<T>> {
  return NextResponse.json({ ok: true, data }, init);
}

export function mogplexApiError(
  code: MogplexApiErrorCode,
  message: string,
  status: number,
  init?: { headers?: HeadersInit }
): NextResponse<MogplexApiErrorBody> {
  return NextResponse.json(
    { ok: false, error: { code, message } },
    { status, headers: init?.headers }
  );
}

export async function resolveMogplexApiUser(
  request: Request,
  deps: {
    resolveApiKey?: typeof resolveApiKey;
    resolveOAuthToken?: typeof resolveMogplexOAuthToken;
  } = {}
) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return {
      ok: false as const,
      response: mogplexApiError("UNAUTHORIZED", "Unauthorized", 401, {
        headers: {
          "WWW-Authenticate": buildMogplexMcpBearerChallenge(request),
        },
      }),
    };
  }

  const isPat = authorization.startsWith("Bearer mog_");
  const result = isPat
    ? await (deps.resolveApiKey ?? resolveApiKey)(authorization)
    : await (deps.resolveOAuthToken ?? resolveMogplexOAuthToken)(authorization);
  if (!result.ok) {
    if (result.reason === "rate_limited") {
      return {
        ok: false as const,
        response: mogplexApiError(
          "RATE_LIMITED",
          `Rate limit exceeded. Retry after ${API_KEY_RATE_LIMIT_WINDOW_SECONDS}s.`,
          429,
          {
            headers: {
              "Retry-After": String(API_KEY_RATE_LIMIT_WINDOW_SECONDS),
            },
          }
        ),
      };
    }
    return {
      ok: false as const,
      response: mogplexApiError("UNAUTHORIZED", "Unauthorized", 401, {
        headers: {
          "WWW-Authenticate": buildMogplexMcpBearerChallenge(request),
        },
      }),
    };
  }

  return {
    ok: true as const,
    userId: result.auth.userId,
    keyId: result.auth.keyId,
    scopes: result.auth.scopes,
  };
}
