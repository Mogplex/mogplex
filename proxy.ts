import { NextResponse } from "next/server";
import type { CookieOptions } from "@supabase/ssr";
import { createServerClient } from "@supabase/ssr";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  allowsDelegatedInternalApiPath,
  isPublicRoutePath,
} from "@/lib/auth-route-policy";
import {
  buildMachineApiAuthFailureResponse,
  getDelegatedUserIdFromRequest,
  getMachineApiAuthResult,
  hasPlaywrightAuthBypass,
  isCliPatApiRequest,
  isMogplexBearerApiRequest,
} from "@/lib/internal-api-auth";
import { isDashboardScopedFirstSegment } from "@/lib/dashboard-rescue";
import { resolveScope, type ScopeLookup } from "@/lib/middleware-scope";
import type { NextRequest } from "next/server";

// Authed routes that live at the root and must NOT be treated as a scope
// segment. Entries are also in RESERVED_SLUGS so no team/user can claim them;
// this set short-circuits scope resolution so the real page can render.
const UNSCOPED_AUTHED_FIRST_SEGMENT = new Set<string>([
  "cli-auth",
  "new",
  "invite",
]);

type PendingCookie = { name: string; value: string; options: CookieOptions };

// supabaseAdmin is the backend-aware data client: the Supabase service-role
// REST client today, the pg-backed Neon shim when MOGPLEX_DATA_BACKEND=neon.
// proxy.ts runs in the Node.js runtime, so the pg path is available here.
function makeScopeDb(): ScopeLookup {
  return {
    findProfileBySlug: async (slug) => {
      const { data } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("slug", slug)
        .maybeSingle();
      return data ? { id: data.id as string } : null;
    },
    findTeamBySlug: async (slug) => {
      const { data } = await supabaseAdmin
        .from("teams")
        .select("id")
        .eq("slug", slug)
        .maybeSingle();
      return data ? { id: data.id as string } : null;
    },
    isTeamMember: async (teamId, userId) => {
      const { data } = await supabaseAdmin
        .from("team_members")
        .select("team_id")
        .eq("team_id", teamId)
        .eq("user_id", userId)
        .maybeSingle();
      return Boolean(data);
    },
  };
}

function notFoundResponse(request: NextRequest) {
  return NextResponse.rewrite(new URL("/_scope-not-found", request.url), {
    status: 404,
  });
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (hasPlaywrightAuthBypass(request)) {
    return NextResponse.next();
  }

  // Public paths run before the machine-auth gate so a request to /install.sh
  // that happens to carry an Authorization header can't get converted into a
  // machine-auth failure response instead of the install script.
  //
  // The root is public (anonymous visitors get the landing page) but still
  // flows through session resolution below: signed-in users landing on "/" —
  // notably the post-login callback, whose fallback destination is "/" —
  // bounce to their personal scope instead of the marketing page.
  if (isPublicRoutePath(pathname) && pathname !== "/") {
    return NextResponse.next();
  }

  const delegatedUserId = allowsDelegatedInternalApiPath(pathname)
    ? getDelegatedUserIdFromRequest(request)
    : null;
  if (delegatedUserId) {
    return NextResponse.next();
  }

  const machineAuthResult = getMachineApiAuthResult(request, pathname);
  if (machineAuthResult.type === "authorized") {
    return NextResponse.next();
  }
  if (
    machineAuthResult.type === "missing_secret" ||
    machineAuthResult.type === "unauthorized"
  ) {
    return buildMachineApiAuthFailureResponse(machineAuthResult);
  }

  // CLI PATs (Bearer mog_*) are only delegated on the narrow set of PAT-aware
  // hosted endpoints. Machine-auth routes stay hard-gated above, and any other
  // API path still requires the normal browser session.
  if (
    isCliPatApiRequest(request, pathname) ||
    isMogplexBearerApiRequest(request, pathname)
  ) {
    return NextResponse.next();
  }

  // Create a response we can mutate (Supabase needs to set refreshed cookies)
  let supabaseResponse = NextResponse.next({ request });
  const pendingCookies: PendingCookie[] = [];

  let user: { id: string } | null;
  if (process.env.MOGPLEX_DATA_BACKEND === "neon") {
    // better-auth session. With cookieCache enabled this usually verifies the
    // signed cookie snapshot without a database round-trip; a stale cache
    // falls through to the real session lookup. Dynamic import keeps the
    // better-auth/pg stack out of the Supabase-backend request path.
    const { auth } = await import("@/lib/better-auth/server");
    const session = await auth.api.getSession({ headers: request.headers });
    user = session?.user ? { id: session.user.id } : null;
  } else {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            for (const { name, value, options } of cookiesToSet) {
              request.cookies.set(name, value);
              pendingCookies.push({ name, value, options });
            }
            supabaseResponse = NextResponse.next({ request });
            for (const { name, value, options } of cookiesToSet)
              supabaseResponse.cookies.set(name, value, options);
          },
        },
      }
    );
    const {
      data: { user: supabaseUser },
    } = await supabase.auth.getUser();
    user = supabaseUser ? { id: supabaseUser.id } : null;
  }

  if (!user) {
    // Anonymous root renders the public landing page — never a login bounce.
    if (pathname === "/") {
      return supabaseResponse;
    }

    const referer = request.headers.get("referer");
    let isAppNavigation = false;
    try {
      isAppNavigation = Boolean(
        referer && new URL(referer).origin === request.nextUrl.origin
      );
    } catch {
      /* malformed referer */
    }

    const loginUrl = new URL("/login", request.url);
    if (isAppNavigation) {
      loginUrl.searchParams.set("expired", "true");
    }

    return NextResponse.redirect(loginUrl);
  }

  // API routes are authed but unscoped — no slug resolution.
  if (pathname.startsWith("/api/")) {
    return supabaseResponse;
  }

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("id, slug")
    .eq("auth_user_id", user.id)
    .single();

  // Authed root: jump to the user's personal scope when slug is known,
  // otherwise let the landing page render (we logged a warning when slug
  // is missing — that's a data-state bug, not a routing bug).
  if (pathname === "/") {
    if (profile?.slug) {
      const url = new URL(`/${profile.slug as string}`, request.url);
      url.search = request.nextUrl.search;
      const redirect = NextResponse.redirect(url);
      for (const { name, value, options } of pendingCookies) {
        redirect.cookies.set(name, value, options);
      }
      return redirect;
    }
    if (profile && !profile.slug) {
      console.warn(
        "[proxy] authed user has no personal slug; rendering landing page",
        { profileId: profile.id }
      );
    }
    return supabaseResponse;
  }

  const firstSegment = pathname.split("/")[1];
  if (!firstSegment) return supabaseResponse;
  if (UNSCOPED_AUTHED_FIRST_SEGMENT.has(firstSegment)) return supabaseResponse;

  const result = await resolveScope(
    firstSegment,
    (profile?.id as string | undefined) ?? null,
    makeScopeDb()
  );

  if (result.status === "not_found") {
    // Rescue unscoped dashboard routes (e.g. `/agents/skills`) when the user
    // has a personal slug — a stale link or sub-nav that dropped the scope
    // prefix shouldn't dead-end on a 404. A real team owning the slug
    // ("agents", "settings", …) still wins because resolveScope would have
    // returned a `team` result above; we only land here when no scope matched.
    //
    // The `profileSlug &&` guard intentionally rejects both a missing profile
    // row and a profile with a blank slug — either would produce a `//path`
    // redirect target that we never want to emit.
    //
    // `profileSlug !== firstSegment` is belt-and-suspenders: if the slug
    // matches, `resolveScope` should already have returned `personal` and we
    // wouldn't be here. Keep the guard so a corrupt profile row (slug present
    // but `auth_user_id` mismatched) can't produce a self-redirect loop.
    const profileSlug = profile?.slug as string | undefined;
    if (
      profileSlug &&
      profileSlug !== firstSegment &&
      isDashboardScopedFirstSegment(firstSegment)
    ) {
      const url = new URL(`/${profileSlug}${pathname}`, request.url);
      url.search = request.nextUrl.search;
      const redirect = NextResponse.redirect(url);
      for (const { name, value, options } of pendingCookies) {
        redirect.cookies.set(name, value, options);
      }
      return redirect;
    }
    return notFoundResponse(request);
  }
  // redirect_login can't fire here — we already short-circuited unauthed
  // requests above — but handle it defensively.
  if (result.status === "redirect_login") {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  const scopeId =
    result.status === "personal" ? result.profileId : result.teamId;

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-mogplex-scope-kind", result.status);
  requestHeaders.set("x-mogplex-scope-slug", result.slug);
  requestHeaders.set("x-mogplex-scope-id", scopeId);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  for (const { name, value, options } of pendingCookies) {
    response.cookies.set(name, value, options);
  }
  return response;
}

// Font assets live in `/public/fonts/**` and are served at the root. Without
// a `fonts/` prefix in the negative lookahead, the proxy treats font requests
// as scope segments and redirects them to /login, breaking `@font-face` on
// every page (notably the Mondwest hero on the marketing landing).
//
// The `fonts/` entry is a path-prefix exemption, so /api/foo.woff still goes
// through the proxy. The image group is different: it is extension-based and
// unanchored, so ANY path ending in one of these extensions (including under
// /api/) bypasses the proxy entirely — no auth, no scope resolution, and no
// header injection, which means inbound x-mogplex-scope-* headers on those
// requests are client-controlled. ScopeLayout defends against that by
// 404ing image-like scope segments before parsing scope headers.
// Keep the image extension group aligned with IMAGE_ASSET_SCOPE_EXTENSIONS in
// lib/scope-context.ts; tests/unit/scope-context.test.ts pins the invariant.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|fonts/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
