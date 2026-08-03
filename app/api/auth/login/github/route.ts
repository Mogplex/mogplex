import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { buildAppUrl, normalizeAppRedirectPath } from "@/lib/app-url";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import {
  WAITLIST_COOKIE_NAME,
  verifyWaitlistCookieValue,
} from "@/lib/waitlist";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = normalizeAppRedirectPath(url.searchParams.get("next"));

  // Pre-launch waitlist gate. A successful POST to /api/auth/waitlist/validate
  // sets an HMAC-signed HttpOnly cookie. Without it, kick back to /login so
  // the user can enter a code before GitHub OAuth starts.
  const cookieStore = await cookies();
  const waitlistCookie = cookieStore.get(WAITLIST_COOKIE_NAME)?.value;
  if (!verifyWaitlistCookieValue(waitlistCookie)) {
    // /login/beta hosts the legacy access-code gate; /login is better-auth.
    const loginUrl = buildAppUrl("/login/beta", request);
    loginUrl.searchParams.set("error", "waitlist_required");
    if (next && next !== "/") loginUrl.searchParams.set("next", next);
    return NextResponse.redirect(loginUrl);
  }

  const supabase = await createSupabaseServerClient();
  const callbackUrl = buildAppUrl("/auth/callback", request);
  callbackUrl.searchParams.set("next", next);

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "github",
    options: {
      redirectTo: callbackUrl.toString(),
      scopes: "read:user user:email repo",
    },
  });

  if (error || !data.url) {
    return NextResponse.redirect(
      buildAppUrl("/login/beta?error=github_login_start", request)
    );
  }

  return NextResponse.redirect(data.url);
}
