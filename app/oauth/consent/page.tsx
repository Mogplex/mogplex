import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { AuthShell } from "@/components/marketing/auth-shell";
import { auth } from "@/lib/better-auth/server";
import { readOAuthConsent } from "@/lib/better-auth/oauth-consent";
import { PRIVATE_NO_INDEX_ROBOTS } from "@/lib/seo";
import { submitOAuthConsent } from "./actions";

export const metadata: Metadata = {
  title: "Connect an app — Mogplex",
  robots: PRIVATE_NO_INDEX_ROBOTS,
};

export const dynamic = "force-dynamic";

const SCOPE_LABELS: Record<string, string> = {
  read: "Read your Mogplex resources",
  write: "Create and update your Mogplex resources",
  offline_access: "Stay connected when you are away",
  openid: "Verify your identity",
  profile: "View your name and profile",
  email: "View your email address",
};

export default async function OAuthConsentPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value])
      params.append(key, item);
  }
  const query = params.toString();
  const context = await auth.$context;
  const consent = await readOAuthConsent(query, context.secret);
  if (!consent) {
    return (
      <AuthShell eyebrow="Connect an app" title="This connection request has expired.">
        <div className="mpx-auth-card">
          <p>Return to the app and start connecting to Mogplex again.</p>
          <Link href="/login" className="mpx-auth-minor">Sign in to Mogplex →</Link>
        </div>
      </AuthShell>
    );
  }
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(`/login?next=${encodeURIComponent(`/oauth/consent?${query}`)}`);
  const client = await context.adapter.findOne<{ name?: string; disabled?: boolean }>({
    model: "oauthClient",
    where: [{ field: "clientId", value: consent.clientId }],
  });
  if (!client || client.disabled) redirect("/oauth/consent");
  return (
    <AuthShell eyebrow="Connect an app" title={<>Connect {client.name || "this app"}?</>}
      subtitle={`Signed in as ${session.user.email}`}>
      <form action={submitOAuthConsent.bind(null, query)} className="mpx-auth-card">
        <p>This app is requesting permission to:</p>
        <ul className="list-disc space-y-2 pl-5">
          {consent.scopes.map((scope) => <li key={scope}>{SCOPE_LABELS[scope] ?? scope}</li>)}
        </ul>
        <p className="mpx-auth-muted">You will return to {consent.destination}.</p>
        <button type="submit" name="decision" value="allow" className="mpx-button is-primary is-small">Allow access</button>
        <button type="submit" name="decision" value="deny" className="mpx-auth-minor">Cancel</button>
      </form>
    </AuthShell>
  );
}
