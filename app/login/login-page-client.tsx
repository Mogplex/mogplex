"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AuthDivider } from "@/components/auth/auth-field";
import { SignInForm } from "@/components/auth/sign-in-form";
import { SignedInPanel } from "@/components/auth/signed-in-panel";
import { SocialButtons } from "@/components/auth/social-buttons";
import { AuthShell } from "@/components/marketing/auth-shell";
import { useSession } from "@/lib/better-auth/client";
import { resolveLoginError, resolveLoginNext } from "@/lib/login-next";

function LoginNotice({
  expired,
  error,
  verified,
  reset,
}: {
  expired: boolean;
  error: string | null;
  verified: boolean;
  reset: boolean;
}) {
  if (!expired && !error && !verified && !reset) return null;

  return (
    <div className="mplex-mono flex flex-col items-center gap-2 text-[11px] tracking-[0.24em] uppercase">
      {expired ? (
        <div className="border border-amber-300/20 bg-amber-300/[0.08] px-3 py-1 text-amber-200">
          session expired — sign in again
        </div>
      ) : null}
      {verified ? (
        <div className="border border-emerald-300/20 bg-emerald-300/[0.08] px-3 py-1 text-emerald-100">
          email verified
        </div>
      ) : null}
      {reset ? (
        <div className="border border-emerald-300/20 bg-emerald-300/[0.08] px-3 py-1 text-emerald-100">
          password updated — sign in
        </div>
      ) : null}
      {error ? (
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
  const verified = params.get("verified") === "1";
  const reset = params.get("reset") === "1";
  const { data: session } = useSession();

  return (
    <AuthShell
      eyebrow="Sign in"
      title={
        <>
          Sign in to <span className="mplex-gradient-text italic">Mogplex</span>
          .
        </>
      }
      subtitle="Use your email and password, or continue with a provider."
      notice={
        <LoginNotice
          expired={expired}
          error={error}
          verified={verified}
          reset={reset}
        />
      }
      footer={
        <div className="flex flex-col items-center gap-1.5">
          <div>
            New to Mogplex?{" "}
            <Link
              href="/signup"
              className="text-white underline underline-offset-4 hover:no-underline"
            >
              Create an account
            </Link>
          </div>
          <div>
            Have a beta access code?{" "}
            <Link
              href="/login/beta"
              className="text-white underline underline-offset-4 hover:no-underline"
            >
              Use the beta sign-in
            </Link>
          </div>
        </div>
      }
    >
      <div className="mplex-panel flex w-full flex-col gap-4 p-5 sm:p-6">
        {session?.user ? (
          <SignedInPanel email={session.user.email} next={next} />
        ) : (
          <>
            <SignInForm next={next} />
            <AuthDivider />
            <SocialButtons next={next} source="login_page" />
            <div className="text-center">
              <Link
                href={`/login/sso?next=${encodeURIComponent(next)}`}
                className="mplex-mono text-marketing-muted text-[11px] tracking-[0.22em] uppercase hover:text-white"
              >
                Use single sign-on (SSO) →
              </Link>
            </div>
          </>
        )}
      </div>
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
