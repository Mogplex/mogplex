"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AuthDivider } from "@/components/auth/auth-field";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { SignedInPanel } from "@/components/auth/signed-in-panel";
import { SocialButtons } from "@/components/auth/social-buttons";
import { AuthShell } from "@/components/marketing/auth-shell";
import { useSession } from "@/lib/better-auth/client";
import {
  checkoutPath,
  parsePlanIntent,
  planIntentSummary,
} from "@/lib/billing/plan-intent";
import { resolveLoginNext } from "@/lib/login-next";

function SignupContent() {
  const params = useSearchParams();
  // A tier card on /pricing passes the plan the visitor clicked. Carry it
  // through signup so they land on checkout for that plan — not on the
  // dashboard with their purchase intent dropped on the floor.
  const plan = parsePlanIntent(params.get("plan"));
  const planNext = plan ? checkoutPath(plan) : null;
  const next = planNext ?? resolveLoginNext(params.get("next"));
  const verifiedNext = planNext
    ? `/login?verified=1&next=${encodeURIComponent(planNext)}`
    : "/login?verified=1";
  const summary = plan ? planIntentSummary(plan) : null;
  const { data: session } = useSession();

  return (
    <AuthShell
      eyebrow="Generally available"
      title={
        <>
          Start <em className="grad">now</em>.
        </>
      }
      subtitle={
        <>
          Connect a repo and wire your first pipeline. PAYG has no monthly fee.
          Tokens pass through at cost, and compute bills by the minute.{" "}
          <Link href="/pricing">See the full rate card.</Link>
        </>
      }
      notice={
        summary ? (
          <div className="mpx-auth-alert is-success" data-testid="plan-chip">
            {summary.name} — {summary.monthlyPrice}/mo · checkout comes after
            this step ·{" "}
            <Link href="/pricing">change plan</Link>
          </div>
        ) : null
      }
      footer={
        <div>
          Already have an account?{" "}
          <Link
            href={planNext ? `/login?next=${encodeURIComponent(planNext)}` : "/login"}
          >
            Sign in
          </Link>
        </div>
      }
    >
      <div className="mpx-auth-card">
        {session?.user ? (
          <SignedInPanel email={session.user.email} next={next} />
        ) : (
          <>
            <SignUpForm verifiedNext={verifiedNext} />
            <AuthDivider />
            <SocialButtons next={next} source="signup_page" />
            <p className="mpx-auth-muted" data-testid="signup-legal">
              By creating an account, you agree to the{" "}
              <Link href="/terms">Terms of Service</Link> and{" "}
              <Link href="/privacy">Privacy Policy</Link>.
            </p>
          </>
        )}
      </div>
      <p className="mpx-auth-foot">
        Prefer to read the code first?{" "}
        <a href="https://github.com/mogplex/mogplex">
          github.com/mogplex/mogplex →
        </a>
      </p>
    </AuthShell>
  );
}

export function SignupPageClient() {
  return (
    <Suspense fallback={<div className="mpx-landing min-h-dvh" />}>
      <SignupContent />
    </Suspense>
  );
}
