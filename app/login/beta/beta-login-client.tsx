"use client";

// DEPRECATED: legacy private-beta entry (waitlist access code → GitHub OAuth
// via Supabase). Kept at /login/beta so existing beta users can still reach
// the Supabase-gated dashboard until the Neon session cutover; /login now
// hosts the better-auth sign-in. Delete this page with the Supabase auth
// stack.

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AuthShell } from "@/components/marketing/auth-shell";
import { WaitlistGateForm } from "@/components/marketing/waitlist-gate-form";
import { resolveLoginError, resolveLoginNext } from "@/lib/login-next";

function LoginNotice({
  expired,
  error,
}: {
  expired: boolean;
  error: string | null;
}) {
  if (!expired && !error) return null;

  return (
    <div className="flex flex-col items-center gap-2">
      {expired ? (
        <div className="mpx-auth-alert is-warn">
          session expired — sign in again
        </div>
      ) : null}
      {error === "waitlist_required" ? (
        <div className="mpx-auth-alert is-accent">
          private beta — access code required
        </div>
      ) : error ? (
        <div className="mpx-auth-alert is-error">
          {error.replace(/_/g, " ")}
        </div>
      ) : null}
    </div>
  );
}

function LoginContent() {
  const params = useSearchParams();
  const next = resolveLoginNext(params.get("next"));
  const error = resolveLoginError(params.get("error"));
  const expired = params.get("expired") === "true";

  return (
    <AuthShell
      eyebrow="Sign in"
      title={
        <>
          Sign in to{" "}
          <em className="grad">Mogplex</em>.
        </>
      }
      subtitle="Private beta. Enter your access code, then continue with GitHub."
      notice={<LoginNotice expired={expired} error={error} />}
      footer={
        <div className="flex flex-col items-center gap-1.5">
          <div>
            No code yet?{" "}
            <Link
              href="/request-access"
            >
              Request access
            </Link>
          </div>
          <div>
            Signed in elsewhere?{" "}
            <Link
              href="/login/new-code"
            >
              Get a new code
            </Link>
          </div>
        </div>
      }
    >
      <WaitlistGateForm
        next={next}
        initialError={error === "waitlist_required" ? null : error}
      />
    </AuthShell>
  );
}

export function BetaLoginClient() {
  return (
    <Suspense fallback={<div className="mpx-landing min-h-dvh" />}>
      <LoginContent />
    </Suspense>
  );
}
