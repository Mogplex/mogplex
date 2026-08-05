// better-auth handler. Static /api/auth/* siblings (login, logout, waitlist,
// github, vercel, user) take precedence over this catch-all while those legacy
// integrations finish moving off Supabase.

import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/better-auth/server";

// Guards run at request time, not module load, so env-less CI/Docker builds
// still import this route during page-data collection without throwing.
async function guardedHandler(request: Request): Promise<Response> {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (
    process.env.NODE_ENV === "production" &&
    (!secret || secret.length < 32)
  ) {
    // Fail closed rather than letting better-auth fall back to its built-in
    // default secret in a production deployment.
    return Response.json(
      { error: "auth_not_configured" },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }

  // SSO provider registration is disabled until the SSO flow is intentionally
  // launched: any authenticated user could otherwise claim an email domain
  // and route that domain's sign-ins through their own IdP. Remove this block
  // (and add explicit authorization) when SSO onboarding ships.
  const { pathname } = new URL(request.url);
  if (pathname.startsWith("/api/auth/sso/register")) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  return auth.handler(request);
}

export const { GET, POST } = toNextJsHandler(guardedHandler);
