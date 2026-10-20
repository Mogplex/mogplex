import { NextResponse } from "next/server";
import { buildAppUrl, normalizeAppRedirectPath } from "@/lib/app-url";

// Legacy Supabase OAuth callback. A code issued by the retired provider cannot
// be exchanged by better-auth, so send the user back to /login.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const next = normalizeAppRedirectPath(searchParams.get("next"));
  const loginUrl = buildAppUrl("/login", request);
  loginUrl.searchParams.set("next", next);
  return NextResponse.redirect(loginUrl);
}
