"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { AuthShell } from "@/components/marketing/auth-shell";

function ResetPasswordContent() {
  const params = useSearchParams();
  // better-auth's emailed link redirects here with ?token=…; an expired or
  // already-used link arrives as ?error=INVALID_TOKEN with no token.
  const rawToken = params.get("token");
  const token = rawToken && params.get("error") === null ? rawToken : null;

  return (
    <AuthShell
      eyebrow="Reset password"
      title={<>Choose a new password.</>}
      subtitle="Your new password signs you in on every device."
      footer={
        <div>
          Back to{" "}
          <Link
            href="/login"
          >
            sign in
          </Link>
        </div>
      }
    >
      <div className="mpx-auth-card">
        <ResetPasswordForm token={token} />
      </div>
    </AuthShell>
  );
}

export function ResetPasswordPageClient() {
  return (
    <Suspense fallback={<div className="mpx-landing min-h-dvh" />}>
      <ResetPasswordContent />
    </Suspense>
  );
}
