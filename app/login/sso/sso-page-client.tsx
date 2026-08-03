"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { SsoForm } from "@/components/auth/sso-form";
import { AuthShell } from "@/components/marketing/auth-shell";
import { resolveLoginNext } from "@/lib/login-next";

function SsoContent() {
  const params = useSearchParams();
  const next = resolveLoginNext(params.get("next"));

  return (
    <AuthShell
      eyebrow="Single sign-on"
      title={
        <>
          Sign in with <span className="mplex-gradient-text italic">SSO</span>.
        </>
      }
      subtitle="Enter your work email and we'll route you to your organization's identity provider."
      footer={
        <div>
          Not using SSO?{" "}
          <Link
            href="/login"
            className="text-white underline underline-offset-4 hover:no-underline"
          >
            Sign in another way
          </Link>
        </div>
      }
    >
      <div className="mplex-panel flex w-full flex-col gap-4 p-5 sm:p-6">
        <SsoForm next={next} />
      </div>
    </AuthShell>
  );
}

export function SsoPageClient() {
  return (
    <Suspense fallback={<div className="mplex-landing min-h-dvh" />}>
      <SsoContent />
    </Suspense>
  );
}
