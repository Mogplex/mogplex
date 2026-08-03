import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/marketing/auth-shell";
import { RequestAccessForm } from "@/components/marketing/request-access-form";
import { buildMarketingMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMarketingMetadata({
  title: "Request access — Mogplex",
  description:
    "Mogplex is in private beta. Request an access code to ship code with AI agents.",
  path: "/request-access",
});

export default function RequestAccessPage() {
  return (
    <AuthShell
      eyebrow="Private beta"
      title={
        <>
          Request{" "}
          <span className="mplex-gradient-text italic">access</span>.
        </>
      }
      subtitle="Tell us a bit about how you'd use Mogplex. We're approving teams in batches."
      footer={
        <>
          Already have a code?{" "}
          <Link
            href="/login/beta"
            className="text-white underline underline-offset-4 hover:no-underline"
          >
            Sign in
          </Link>
        </>
      }
    >
      <RequestAccessForm />
    </AuthShell>
  );
}
