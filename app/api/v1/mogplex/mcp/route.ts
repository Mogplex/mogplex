import { resolveApiKey } from "@/lib/auth/api-key";
import { resolveMogplexOAuthToken } from "@/lib/auth/mogplex-oauth";
import { getCanonicalAppUrl } from "@/lib/app-url";
import { MogplexApiClient } from "@/lib/mogplex-api/client";
import {
  MOGPLEX_MCP_PROTOCOL_VERSION,
  handleMogplexMcpPayload,
  jsonRpcError,
  type MogplexMcpClient,
} from "@/lib/mogplex-api/mcp";
import { buildMogplexMcpBearerChallenge } from "@/lib/mogplex-api/oauth-config";
import type { NextRequest } from "next/server";

type MogplexMcpPostDeps = {
  resolveApiKey: typeof resolveApiKey;
  resolveOAuthToken: typeof resolveMogplexOAuthToken;
  createClient: (input: {
    request: NextRequest;
    authorization: string;
  }) => MogplexMcpClient;
  handlePayload: typeof handleMogplexMcpPayload;
};

const defaultMogplexMcpPostDeps: MogplexMcpPostDeps = {
  resolveApiKey,
  resolveOAuthToken: resolveMogplexOAuthToken,
  createClient: ({ request, authorization }) =>
    new MogplexApiClient({
      baseUrl: resolveMogplexMcpApiBaseUrl(request),
      authorization,
    }),
  handlePayload: handleMogplexMcpPayload,
};

function getJsonRpcIdForError(payload: unknown) {
  if (
    typeof payload === "object" &&
    payload !== null &&
    !Array.isArray(payload) &&
    "id" in payload
  ) {
    const id = payload.id;
    if (typeof id === "string" || typeof id === "number" || id === null) {
      return id;
    }
  }
  return null;
}

let cachedAllowedOriginsRaw: string | null = null;
let cachedAllowedOrigins: string[] = [];

function getAllowedOrigins() {
  // This is a warm-instance cache for deployment config. It is invalidated if
  // tests or a local process mutate process.env; platform env changes still
  // require the normal redeploy/cold-start cycle to reach every instance.
  const raw = process.env.MOGPLEX_MCP_ALLOWED_ORIGINS ?? "";
  if (raw === cachedAllowedOriginsRaw) return cachedAllowedOrigins;

  cachedAllowedOriginsRaw = raw;
  cachedAllowedOrigins = raw
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return cachedAllowedOrigins;
}

function getOriginDecision(request: NextRequest) {
  const origin = request.headers.get("origin");
  const requestOrigin = new URL(request.url).origin;
  return {
    origin,
    requestOrigin,
    allowed:
      !origin ||
      origin === requestOrigin ||
      getAllowedOrigins().includes(origin),
  };
}

function logRejectedCorsOrigin(request: NextRequest) {
  const { origin, requestOrigin } = getOriginDecision(request);
  if (!origin) return;

  console.warn("[mogplex-mcp/cors] rejected origin", {
    origin,
    requestOrigin,
    allowedOrigins: getAllowedOrigins(),
  });
}

function setCorsHeaders(headers: Headers, request?: NextRequest) {
  if (!request) return headers;

  const { origin, allowed } = getOriginDecision(request);
  if (!origin) return headers;

  headers.set("vary", "origin");
  if (allowed) {
    headers.set("access-control-allow-origin", origin);
  }

  return headers;
}

function jsonRpcResponse(
  payload: unknown,
  init: ResponseInit = {},
  request?: NextRequest
) {
  const headers = new Headers(init.headers);
  headers.set("cache-control", "no-store");
  headers.set("mcp-protocol-version", MOGPLEX_MCP_PROTOCOL_VERSION);
  setCorsHeaders(headers, request);

  return Response.json(payload, {
    ...init,
    headers,
  });
}

function acceptedResponse(request: NextRequest) {
  const headers = new Headers({
    "cache-control": "no-store",
    "mcp-protocol-version": MOGPLEX_MCP_PROTOCOL_VERSION,
  });
  setCorsHeaders(headers, request);

  return new Response(null, {
    status: 202,
    headers,
  });
}

function methodNotAllowedResponse() {
  return new Response(null, {
    status: 405,
    headers: {
      allow: "POST, OPTIONS",
      "cache-control": "no-store",
    },
  });
}

function isAllowedOrigin(
  request: NextRequest,
  options: { logRejected?: boolean } = {}
) {
  const allowed = getOriginDecision(request).allowed;
  if (!allowed && options.logRejected) {
    logRejectedCorsOrigin(request);
  }
  return allowed;
}

function resolveMogplexMcpApiBaseUrl(request: Request) {
  const configured = process.env.MOGPLEX_API_URL?.trim();
  if (configured) return new URL(configured);
  return getCanonicalAppUrl(request);
}

async function parseJsonBody(request: NextRequest) {
  try {
    return {
      ok: true as const,
      payload: await request.json(),
    };
  } catch {
    return {
      ok: false as const,
      response: jsonRpcResponse(
        jsonRpcError(null, -32700, "Parse error: invalid JSON"),
        { status: 400 },
        request
      ),
    };
  }
}

async function resolveMcpAuthorization(
  request: NextRequest,
  deps: Pick<MogplexMcpPostDeps, "resolveApiKey" | "resolveOAuthToken">,
  payload: unknown
): Promise<
  { ok: true; authorization: string } | { ok: false; response: Response }
> {
  const authorization = request.headers.get("authorization");
  const id = getJsonRpcIdForError(payload);

  if (!authorization?.startsWith("Bearer ")) {
    return {
      ok: false,
      response: jsonRpcResponse(
        jsonRpcError(id, -32001, "Unauthorized", {
          code: "UNAUTHORIZED",
          suggestion: "Sign in with OAuth or configure a Mogplex API token.",
        }),
        {
          status: 401,
          headers: {
            "WWW-Authenticate": buildMogplexMcpBearerChallenge(request),
          },
        },
        request
      ),
    };
  }

  const isPat = authorization.startsWith("Bearer mog_");
  const auth = isPat
    ? await deps.resolveApiKey(authorization)
    : await deps.resolveOAuthToken(authorization);
  if (!auth.ok) {
    if (auth.reason === "rate_limited") {
      return {
        ok: false,
        response: jsonRpcResponse(
          jsonRpcError(id, -32002, "Rate limit exceeded", {
            code: "RATE_LIMITED",
            suggestion: "Retry after the rate-limit window resets.",
          }),
          { status: 429, headers: { "Retry-After": "60" } },
          request
        ),
      };
    }
    return {
      ok: false,
      response: jsonRpcResponse(
        jsonRpcError(id, -32001, "Unauthorized", {
          code: "UNAUTHORIZED",
          suggestion: "Sign in with OAuth or configure a Mogplex API token.",
        }),
        {
          status: 401,
          headers: {
            "WWW-Authenticate": buildMogplexMcpBearerChallenge(request),
          },
        },
        request
      ),
    };
  }

  return {
    ok: true,
    authorization,
  };
}

export function createMogplexMcpPostHandler(
  overrides: Partial<MogplexMcpPostDeps> = {}
) {
  const deps: MogplexMcpPostDeps = {
    ...defaultMogplexMcpPostDeps,
    ...overrides,
  };

  return async function POST(request: NextRequest) {
    if (!isAllowedOrigin(request, { logRejected: true })) {
      return jsonRpcResponse(
        jsonRpcError(undefined, -32003, "Forbidden origin", {
          code: "FORBIDDEN_ORIGIN",
        }),
        { status: 403 },
        request
      );
    }

    const parsed = await parseJsonBody(request);
    if (!parsed.ok) return parsed.response;

    const auth = await resolveMcpAuthorization(request, deps, parsed.payload);
    if (!auth.ok) return auth.response;

    const result = await deps.handlePayload(parsed.payload, {
      client: deps.createClient({
        request,
        authorization: auth.authorization,
      }),
    });

    if (!result) return acceptedResponse(request);
    return jsonRpcResponse(result, {}, request);
  };
}

export const POST = createMogplexMcpPostHandler();

export function OPTIONS(request: NextRequest) {
  const allowed = isAllowedOrigin(request, { logRejected: true });
  const headers = new Headers({ "cache-control": "no-store", vary: "origin" });

  if (!allowed) {
    return new Response(null, {
      status: 403,
      headers,
    });
  }

  headers.set("allow", "POST, OPTIONS");
  headers.set(
    "access-control-allow-headers",
    "authorization, content-type, mcp-protocol-version, mcp-session-id"
  );
  headers.set("access-control-allow-methods", "POST, OPTIONS");
  headers.set("access-control-max-age", "86400");
  setCorsHeaders(headers, request);

  return new Response(null, {
    status: 204,
    headers,
  });
}

export function GET() {
  return methodNotAllowedResponse();
}
