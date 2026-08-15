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
import {
  resolveAuthorizeResumeNext,
  resolveLoginError,
  resolveLoginNext,
} from "@/lib/login-next";

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
    <div className="flex flex-col items-center gap-2">
      {expired ? (
        <div className="mpx-auth-alert is-warn">
          session expired — sign in again
        </div>
      ) : null}
      {verified ? (
        <div className="mpx-auth-alert is-success">
          email verified
        </div>
      ) : null}
      {reset ? (
        <div className="mpx-auth-alert is-success">
          password updated — sign in
        </div>
      ) : null}
      {error ? (
        <div className="mpx-auth-alert is-error">
          {error.replace(/_/g, " ")}
        </div>
      ) : null}
    </div>
  );
}

function LoginContent() {
  const params = useSearchParams();
  // OAuth authorize requests (mogplex CLI, hosted MCP clients) land here
  // with the raw authorize query instead of `next` — resume them after login.
  const next = params.get("next")
    ? resolveLoginNext(params.get("next"))
    : (resolveAuthorizeResumeNext(new URLSearchParams(params.toString())) ??
      resolveLoginNext(null));
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
          Sign in to <em className="grad">Mogplex</em>
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
            >
              Create an account
            </Link>
          </div>
        </div>
      }
    >
      <div className="mpx-auth-card">
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
                className="mpx-auth-minor"
              >
                Use single sign-on (SSO) →
              </Link>
            </div>
            <p className="mpx-auth-muted" data-testid="login-legal">
              By continuing, you agree to the{" "}
              <Link href="/terms">Terms of Service</Link> and{" "}
              <Link href="/privacy">Privacy Policy</Link>.
            </p>
          </>
        )}
      </div>
    </AuthShell>
  );
}

export function LoginPageClient() {
  return (
    <Suspense fallback={<div className="mpx-landing min-h-dvh" />}>
      <LoginContent />
    </Suspense>
  );
}
