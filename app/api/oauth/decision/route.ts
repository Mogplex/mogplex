import { NextResponse } from "next/server";
import { getCanonicalAppUrl } from "@/lib/app-url";
import {
  registerMogplexOAuthClient,
  removeMogplexOAuthClientRegistration,
} from "@/lib/mogplex-api/oauth-clients";
import { getMogplexMcpResourceUrl } from "@/lib/mogplex-api/oauth-config";
import {
  buildMogplexOAuthConsentPath,
  buildMogplexOAuthTerminalErrorPath,
  parseMogplexAuthorizationId,
  parseMogplexOAuthDecision,
} from "@/lib/mogplex-api/oauth-consent";
import { createClient } from "@/lib/supabase/server";

type MogplexOAuthDecisionDeps = {
  createClient: typeof createClient;
  registerClient: typeof registerMogplexOAuthClient;
  removeRegistration: typeof removeMogplexOAuthClientRegistration;
};

const defaultDeps: MogplexOAuthDecisionDeps = {
  createClient,
  registerClient: registerMogplexOAuthClient,
  removeRegistration: removeMogplexOAuthClientRegistration,
};

function hasSameOrigin(request: Request) {
  const expectedOrigin = getCanonicalAppUrl(request).origin;
  const origin = request.headers.get("origin");
  if (origin) return origin === expectedOrigin;

  const referer = request.headers.get("referer");
  if (!referer) return false;
  try {
    return new URL(referer).origin === expectedOrigin;
  } catch {
    return false;
  }
}

export function createMogplexOAuthDecisionHandler(
  overrides: Partial<MogplexOAuthDecisionDeps> = {}
) {
  const deps = { ...defaultDeps, ...overrides };

  return async function POST(request: Request) {
    if (!hasSameOrigin(request)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json({ error: "Invalid form" }, { status: 400 });
    }

    const authorizationId = parseMogplexAuthorizationId(
      form.get("authorization_id")
    );
    const decision = parseMogplexOAuthDecision(form.get("decision"));
    if (!authorizationId || !decision) {
      return NextResponse.json({ error: "Invalid decision" }, { status: 400 });
    }

    const supabase = await deps.createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      const next = buildMogplexOAuthConsentPath(authorizationId);
      return NextResponse.redirect(
        new URL(`/login?next=${encodeURIComponent(next)}`, request.url),
        303
      );
    }

    const { data: details, error: detailsError } =
      await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
    if (detailsError || !details) {
      return NextResponse.redirect(
        new URL(
          buildMogplexOAuthConsentPath(authorizationId, "request_expired"),
          request.url
        ),
        303
      );
    }
    if ("redirect_url" in details) {
      return NextResponse.redirect(details.redirect_url, 303);
    }

    let registration: Awaited<ReturnType<typeof registerMogplexOAuthClient>> =
      null;
    if (decision === "approve") {
      try {
        registration = await deps.registerClient({
          clientId: details.client.id,
          clientName: details.client.name,
          approvedBy: user.id,
          resourceUrl: getMogplexMcpResourceUrl(request),
        });
      } catch {
        return NextResponse.redirect(
          new URL(
            buildMogplexOAuthConsentPath(
              authorizationId,
              "client_registration_failed"
            ),
            request.url
          ),
          303
        );
      }
    }

    let result: Awaited<
      ReturnType<typeof supabase.auth.oauth.approveAuthorization>
    > | null;
    try {
      result =
        decision === "approve"
          ? await supabase.auth.oauth.approveAuthorization(authorizationId, {
              skipBrowserRedirect: true,
            })
          : await supabase.auth.oauth.denyAuthorization(authorizationId, {
              skipBrowserRedirect: true,
            });
    } catch {
      result = null;
    }

    if (!result || result.error || !result.data?.redirect_url) {
      if (registration) {
        await deps.removeRegistration(registration).catch((error: unknown) => {
          console.error(
            "[mogplex-oauth] failed to roll back client admission",
            {
              clientId: registration.clientId,
              error,
            }
          );
        });
      }
      return NextResponse.redirect(
        new URL(
          buildMogplexOAuthTerminalErrorPath("consent_failed"),
          request.url
        ),
        303
      );
    }

    return NextResponse.redirect(result.data.redirect_url, 303);
  };
}

export const POST = createMogplexOAuthDecisionHandler();
