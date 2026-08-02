import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/marketing/auth-shell";
import { Button } from "@/components/ui/button";
import {
  buildMogplexOAuthConsentPath,
  parseMogplexAuthorizationId,
} from "@/lib/mogplex-api/oauth-consent";
import { PRIVATE_NO_INDEX_ROBOTS } from "@/lib/seo";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Authorize local agent — Mogplex",
  robots: PRIVATE_NO_INDEX_ROBOTS,
};

function ConsentError({ message }: { message: string }) {
  return (
    <AuthShell
      eyebrow="OAuth authorization"
      title="Authorization unavailable"
      subtitle={message}
    >
      <div className="border border-rose-300/20 bg-rose-300/[0.08] px-4 py-3 text-center text-sm text-rose-100">
        Return to your MCP client and start the sign-in again.
      </div>
    </AuthShell>
  );
}

export default async function MogplexOAuthConsentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawAuthorizationId = Array.isArray(params.authorization_id)
    ? params.authorization_id[0]
    : params.authorization_id;
  const authorizationId = parseMogplexAuthorizationId(rawAuthorizationId);
  if (!authorizationId) {
    const decisionError = Array.isArray(params.decision_error)
      ? params.decision_error[0]
      : params.decision_error;
    return (
      <ConsentError
        message={
          decisionError
            ? "Mogplex could not finish the authorization."
            : "The authorization request is invalid."
        }
      />
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    const next = buildMogplexOAuthConsentPath(authorizationId);
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  const { data, error } =
    await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
  if (error || !data) {
    return <ConsentError message="This authorization request has expired." />;
  }
  if ("redirect_url" in data) redirect(data.redirect_url);

  const decisionError = Array.isArray(params.decision_error)
    ? params.decision_error[0]
    : params.decision_error;
  const requestedScopes = data.scope.split(/\s+/).filter(Boolean);

  return (
    <AuthShell
      eyebrow="OAuth authorization"
      title={
        <>
          Connect{" "}
          <span className="mplex-gradient-text italic">{data.client.name}</span>
        </>
      }
      subtitle={`Signed in as ${user.email ?? data.user.email}`}
      notice={
        decisionError ? (
          <div className="border border-rose-300/20 bg-rose-300/[0.08] px-3 py-1 text-[11px] text-rose-100 uppercase">
            Authorization failed. Try again.
          </div>
        ) : null
      }
      footer="You can revoke this connection later from your Mogplex account."
    >
      <div className="text-marketing-muted border border-white/10 bg-white/[0.035] p-5 text-sm">
        <p className="text-white">This client will be able to:</p>
        <ul className="mt-3 list-disc space-y-2 pl-5 leading-6">
          <li>
            Read repositories, automations, models, run history, and logs.
          </li>
          <li>Create, edit, publish, and trigger automations.</li>
          <li>Create sandboxes and inspect their output.</li>
        </ul>
        {requestedScopes.length > 0 ? (
          <p className="mt-4 border-t border-white/10 pt-3 text-xs">
            OAuth scopes: {requestedScopes.join(", ")}
          </p>
        ) : null}
      </div>

      <form
        action="/api/oauth/decision"
        method="post"
        className="mt-4 grid grid-cols-2 gap-3"
      >
        <input type="hidden" name="authorization_id" value={authorizationId} />
        <Button type="submit" name="decision" value="deny" variant="outline">
          Deny
        </Button>
        <Button type="submit" name="decision" value="approve">
          Allow access
        </Button>
      </form>
    </AuthShell>
  );
}
