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
      footer={
        <div>
          Already have an account?{" "}
          <Link
            href="/login"
          >
            Sign in
          </Link>
        </div>
      }
    >
      <div className="mpx-auth-card">
        <SignUpForm verifiedNext="/login?verified=1" />
        <AuthDivider />
        <SocialButtons next={next} source="signup_page" />
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
