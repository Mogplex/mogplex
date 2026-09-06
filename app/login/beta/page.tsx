import type { Metadata } from "next";
import { NO_INDEX_ROBOTS } from "@/lib/seo";
import { BetaLoginClient } from "./beta-login-client";
import { redirect } from "next/navigation";
import { normalizeAppRedirectPath } from "@/lib/app-url";

export const metadata: Metadata = {
  title: "Legacy sign-in — Mogplex",
  description: "Sign in to Mogplex with a legacy access code.",
  robots: NO_INDEX_ROBOTS,
};

export default async function BetaLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  if (process.env.MOGPLEX_DATA_BACKEND === "neon") {
    const params = await searchParams;
    const next = normalizeAppRedirectPath(
      typeof params.next === "string" ? params.next : undefined
    );
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }
  return <BetaLoginClient />;
}
