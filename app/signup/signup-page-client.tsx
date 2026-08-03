"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AuthDivider } from "@/components/auth/auth-field";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { SocialButtons } from "@/components/auth/social-buttons";
import { AuthShell } from "@/components/marketing/auth-shell";
import { resolveLoginNext } from "@/lib/login-next";

function SignupContent() {
  const params = useSearchParams();
  const next = resolveLoginNext(params.get("next"));

  return (
    <AuthShell
      eyebrow="Create account"
      title={
        <>
          Create your{" "}
          <span className="mplex-gradient-text italic">Mogplex</span> account.
        </>
      }
      subtitle="Sign up with your email and password, or continue with a provider."
      footer={
        <div>
          Already have an account?{" "}
          <Link
            href="/login"
            className="text-white underline underline-offset-4 hover:no-underline"
          >
            Sign in
          </Link>
        </div>
      }
    >
      <div className="mplex-panel flex w-full flex-col gap-4 p-5 sm:p-6">
        <SignUpForm verifiedNext="/login?verified=1" />
        <AuthDivider />
        <SocialButtons next={next} source="signup_page" />
      </div>
    </AuthShell>
  );
}

export function SignupPageClient() {
  return (
    <Suspense fallback={<div className="mplex-landing min-h-dvh" />}>
      <SignupContent />
    </Suspense>
  );
}
