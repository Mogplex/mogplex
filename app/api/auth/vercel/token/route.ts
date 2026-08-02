import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { getCanonicalAppUrl } from "@/lib/app-url";
import { deleteOAuthToken, storeOAuthToken } from "@/lib/oauth-tokens";

type PostBody = { token?: unknown };

type TokenRouteDeps = {
  requireUserId: typeof requireUserId;
  storeOAuthToken: typeof storeOAuthToken;
  deleteOAuthToken: typeof deleteOAuthToken;
  fetch: typeof fetch;
};

const defaultDeps: TokenRouteDeps = {
  requireUserId,
  storeOAuthToken,
  deleteOAuthToken,
  fetch,
};

// We validate against /v2/teams instead of /v2/user because the failure mode
// we're protecting against is the Sign-in-with-Vercel OIDC token — it passes
// /v2/user but is rejected by /v2/teams with 403. Storing such a token would
// re-create the bug this route exists to fix (see commit history for the
// VERCEL_TARGETS_FORBIDDEN escalation work).
async function validateVercelApiToken(token: string, fetchImpl: typeof fetch) {
  const response = await fetchImpl("https://api.vercel.com/v2/teams?limit=1", {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (response.ok) return { ok: true as const };

  if (response.status === 401) {
    return {
      ok: false as const,
      status: 401,
      error: "VERCEL_TOKEN_INVALID",
      message: "Vercel rejected this token. Generate a new one and try again.",
    };
  }

  if (response.status === 403) {
    return {
      ok: false as const,
      status: 403,
      error: "VERCEL_TOKEN_INSUFFICIENT_SCOPE",
      message:
        "This token can't list teams or projects. Create a Personal Access Token at vercel.com/account/tokens with full access.",
    };
  }

  return {
    ok: false as const,
    status: 502,
    error: "VERCEL_TOKEN_VALIDATION_FAILED",
    message: `Vercel returned ${response.status} while validating the token.`,
  };
}

// Defence-in-depth guard for the auth contract.
//
// `requireUserId()` is typed `Promise<string | NextResponse>`; today the
// `instanceof Response` check works because NextResponse extends Response.
// If that contract is ever widened (e.g. returning `{ error, status }`) the
// guard would silently fall through and we'd pass a non-string into
// storeOAuthToken / deleteOAuthToken. This route is a privileged write, so
// we type-narrow on `typeof === "string"` directly instead of trusting the
// upstream subclass relationship — anything else gets a 401.
function isAuthorizedUserId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function unauthorizedResponse(value: unknown): Response {
  // The `instanceof Response` branch is an intentional pass-through of the
  // auth helper's existing rejection response (today a NextResponse, which
  // extends Response). Unlike the caller-site contract check this function
  // protects, forwarding an already-built rejection response is the desired
  // behaviour even if `requireUserId`'s return type changes — anything that
  // isn't a string and isn't a Response still becomes a fresh 401 below.
  return value instanceof Response
    ? value
    : NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

// CSRF guard with two layers, both required:
//
// 1. X-Requested-With header. Custom headers force a CORS preflight on cross-
//    origin fetches; this route doesn't answer preflight, so the browser
//    blocks the request before our handler runs. This depends on browsers
//    enforcing CORS — it is not a token check.
//
// 2. Origin/Referer must match our canonical app URL. This does not depend on
//    CORS configuration at all: even if a future middleware change broadened
//    Access-Control-Allow-Origin, the attacker's Origin header (set by the
//    browser, not forgeable from JS) would still fail this check.
//
// Together with the SameSite=Lax session cookie, an attacker cannot forge a
// request that overwrites the victim's stored Vercel PAT.
//
// Caveat: `getCanonicalAppUrl()` falls back to `request.url`'s origin when
// neither APP_URL nor VERCEL_URL is configured AND NODE_ENV !== 'production'.
// In that dev-fallback path expectedOrigin equals the attacker-supplied origin
// and this guard degrades to a no-op. Production deploys always set APP_URL
// or VERCEL_URL, so the guard is load-bearing there; the degradation is
// acceptable only because it cannot occur in any deployed environment.
function rejectIfCsrfSuspect(request: Request) {
  if (request.headers.get("x-requested-with") !== "XMLHttpRequest") {
    return NextResponse.json(
      { error: "Missing X-Requested-With header" },
      { status: 403 }
    );
  }

  const expectedOrigin = getCanonicalAppUrl(request).origin;
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");

  if (origin !== null) {
    if (origin !== expectedOrigin) {
      return NextResponse.json({ error: "Origin mismatch" }, { status: 403 });
    }
    return null;
  }

  // No Origin header (some same-origin browsers omit it on POST). Fall back
  // to Referer, which the browser sets and the page cannot forge.
  if (!referer) {
    return NextResponse.json(
      { error: "Missing Origin or Referer header" },
      { status: 403 }
    );
  }
  let refererOrigin: string;
  try {
    refererOrigin = new URL(referer).origin;
  } catch {
    return NextResponse.json(
      { error: "Invalid Referer header" },
      { status: 403 }
    );
  }
  if (refererOrigin !== expectedOrigin) {
    return NextResponse.json({ error: "Referer mismatch" }, { status: 403 });
  }
  return null;
}

export function createVercelTokenPostHandler(
  overrides: Partial<TokenRouteDeps> = {}
) {
  const deps: TokenRouteDeps = { ...defaultDeps, ...overrides };

  return async function POST(request: Request) {
    const csrfRejection = rejectIfCsrfSuspect(request);
    if (csrfRejection) return csrfRejection;

    const userId = await deps.requireUserId();
    if (!isAuthorizedUserId(userId)) return unauthorizedResponse(userId);

    let body: PostBody;
    try {
      const raw = await request.json();
      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
        return NextResponse.json(
          { error: "Body must be a JSON object" },
          { status: 400 }
        );
      }
      body = raw as PostBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (!token) {
      return NextResponse.json({ error: "Token is required" }, { status: 400 });
    }

    let validation: Awaited<ReturnType<typeof validateVercelApiToken>>;
    try {
      validation = await validateVercelApiToken(token, deps.fetch);
    } catch (error) {
      // fetch throws on network errors (DNS, timeout, Vercel outage).
      // Surface this as the same structured validation-failure error the
      // happy-path emits for non-OK upstream responses, so the client can
      // show a meaningful message instead of a generic 500.
      console.error(
        "[vercel-token] validation request failed",
        error instanceof Error ? error.message : String(error)
      );
      return NextResponse.json(
        {
          error: "VERCEL_TOKEN_VALIDATION_FAILED",
          message:
            "Couldn't reach Vercel to validate the token. Check your connection and try again.",
        },
        { status: 502 }
      );
    }
    if (!validation.ok) {
      return NextResponse.json(
        { error: validation.error, message: validation.message },
        { status: validation.status }
      );
    }

    try {
      await deps.storeOAuthToken(userId, "vercel", token);
    } catch (error) {
      // Log only the message string — never the raw error — to keep a
      // future Supabase client serialiser from leaking the PAT value via
      // RPC args attached to the error object.
      console.error(
        "[vercel-token] store failed",
        error instanceof Error ? error.message : String(error)
      );
      return NextResponse.json(
        { error: "VERCEL_TOKEN_STORE_FAILED" },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  };
}

export function createVercelTokenDeleteHandler(
  overrides: Partial<TokenRouteDeps> = {}
) {
  const deps: TokenRouteDeps = { ...defaultDeps, ...overrides };

  return async function DELETE(request: Request) {
    const csrfRejection = rejectIfCsrfSuspect(request);
    if (csrfRejection) return csrfRejection;

    const userId = await deps.requireUserId();
    if (!isAuthorizedUserId(userId)) return unauthorizedResponse(userId);

    try {
      await deps.deleteOAuthToken(userId, "vercel");
    } catch (error) {
      console.error(
        "[vercel-token] delete failed",
        error instanceof Error ? error.message : String(error)
      );
      return NextResponse.json(
        { error: "VERCEL_TOKEN_DELETE_FAILED" },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  };
}

export const POST = createVercelTokenPostHandler();
export const DELETE = createVercelTokenDeleteHandler();
