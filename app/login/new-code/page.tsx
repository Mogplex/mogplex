import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/marketing/auth-shell";
import { NewCodeForm } from "@/components/marketing/new-code-form";
import { NO_INDEX_ROBOTS } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Get a new code — Mogplex",
  description:
    "Already signed in to Mogplex on another device? Email yourself a new single-use access code.",
  robots: NO_INDEX_ROBOTS,
};

export default function NewCodePage() {
  return (
    <AuthShell
      eyebrow="New code"
      title={
        <>
          Get a new{" "}
          <em className="grad">access code</em>.
        </>
      }
      subtitle="Lost the code from a previous device? Enter the email tied to your account and we'll send a single-use replacement."
      footer={
        <>
          Have a code?{" "}
          <Link
            href="/login/beta"
          >
            Back to sign in
          </Link>
        </>
      }
    >
      <NewCodeForm />
    </AuthShell>
  );
}
