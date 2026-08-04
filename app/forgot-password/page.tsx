import type { Metadata } from "next";
import Link from "next/link";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { AuthShell } from "@/components/marketing/auth-shell";
import { NO_INDEX_ROBOTS } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Reset password — Mogplex",
  description: "Request a password reset link for your Mogplex account.",
  robots: NO_INDEX_ROBOTS,
};

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      eyebrow="Reset password"
      title={
        <>
          Reset your <em className="grad">Mogplex</em>{" "}
          password.
        </>
      }
      subtitle="Enter your account email and we'll send you a reset link."
      footer={
        <div>
          Remembered it?{" "}
          <Link
            href="/login"
          >
            Sign in
          </Link>
        </div>
      }
    >
      <div className="mpx-auth-card">
        <ForgotPasswordForm />
      </div>
    </AuthShell>
  );
}
