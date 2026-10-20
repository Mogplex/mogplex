import { NextResponse } from "next/server";
import { buildAppUrl, normalizeAppRedirectPath } from "@/lib/app-url";

// Legacy entry point for the retired Supabase GitHub OAuth flow. GitHub sign-in
// now starts from better-auth on /login; keep this route so old links land
// there instead of 404ing.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = normalizeAppRedirectPath(url.searchParams.get("next"));
  const loginUrl = buildAppUrl("/login", request);
  loginUrl.searchParams.set("next", next);
  return NextResponse.redirect(loginUrl);
}
