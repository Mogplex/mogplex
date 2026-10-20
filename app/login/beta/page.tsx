import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NO_INDEX_ROBOTS } from "@/lib/seo";
import { normalizeAppRedirectPath } from "@/lib/app-url";

export const metadata: Metadata = {
  title: "Legacy sign-in — Mogplex",
  description: "Sign in to Mogplex with a legacy access code.",
  robots: NO_INDEX_ROBOTS,
};

// The legacy access-code sign-in was retired with Supabase; /login is the only
// sign-in surface.
export default async function BetaLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const params = await searchParams;
  const next = normalizeAppRedirectPath(
    typeof params.next === "string" ? params.next : undefined
  );
  redirect(`/login?next=${encodeURIComponent(next)}`);
}
