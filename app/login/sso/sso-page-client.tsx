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
          Sign in with <em className="grad">SSO</em>.
        </>
      }
      subtitle="Enter your work email and we'll route you to your organization's identity provider."
      footer={
        <div>
          Not using SSO?{" "}
          <Link
            href="/login"
          >
            Sign in another way
          </Link>
        </div>
      }
    >
      <div className="mpx-auth-card">
        <SsoForm next={next} />
      </div>
    </AuthShell>
  );
}

export function SsoPageClient() {
  return (
    <Suspense fallback={<div className="mpx-landing min-h-dvh" />}>
      <SsoContent />
    </Suspense>
  );
}
