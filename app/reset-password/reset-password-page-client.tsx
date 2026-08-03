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
            className="text-white underline underline-offset-4 hover:no-underline"
          >
            sign in
          </Link>
        </div>
      }
    >
      <div className="mplex-panel flex w-full flex-col gap-4 p-5 sm:p-6">
        <ResetPasswordForm token={token} />
      </div>
    </AuthShell>
  );
}

export function ResetPasswordPageClient() {
  return (
    <Suspense fallback={<div className="mplex-landing min-h-dvh" />}>
      <ResetPasswordContent />
    </Suspense>
  );
}
