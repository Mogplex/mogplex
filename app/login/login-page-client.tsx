"use client";

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
    <div className="mplex-mono flex flex-col items-center gap-2 text-[11px] tracking-[0.24em] uppercase">
      {expired ? (
        <div className="border border-amber-300/20 bg-amber-300/[0.08] px-3 py-1 text-amber-200">
          session expired — sign in again
        </div>
      ) : null}
      {error === "waitlist_required" ? (
        <div className="border border-violet-300/25 bg-violet-300/[0.08] px-3 py-1 text-violet-100">
          private beta — access code required
        </div>
      ) : error ? (
        <div className="border border-rose-300/20 bg-rose-300/[0.08] px-3 py-1 text-rose-200">
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
          <span className="mplex-gradient-text italic">Mogplex</span>.
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
              className="text-white underline underline-offset-4 hover:no-underline"
            >
              Request access
            </Link>
          </div>
          <div>
            Signed in elsewhere?{" "}
            <Link
              href="/login/new-code"
              className="text-white underline underline-offset-4 hover:no-underline"
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

export function LoginPageClient() {
  return (
    <Suspense fallback={<div className="mplex-landing min-h-dvh" />}>
      <LoginContent />
    </Suspense>
  );
}
