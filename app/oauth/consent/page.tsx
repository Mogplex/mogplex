import type { Metadata } from "next";
import { AuthShell } from "@/components/marketing/auth-shell";
import { PRIVATE_NO_INDEX_ROBOTS } from "@/lib/seo";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Authorize local agent — Mogplex",
  robots: PRIVATE_NO_INDEX_ROBOTS,
};

// Consent screen for the retired Supabase OAuth authorization server. Links
// from old MCP client sessions land here; they must start a new connection.
export default function MogplexOAuthConsentPage() {
  return (
    <AuthShell
      eyebrow="OAuth authorization"
      title="Authorization unavailable"
      subtitle="This authorization link is no longer supported. Start a new connection from your MCP client."
    >
      <div className="mpx-auth-alert is-error text-center">
        Return to your MCP client and start the sign-in again.
      </div>
    </AuthShell>
  );
}
