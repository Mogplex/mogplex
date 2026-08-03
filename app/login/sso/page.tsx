import type { Metadata } from "next";
import { NO_INDEX_ROBOTS } from "@/lib/seo";
import { SsoPageClient } from "./sso-page-client";

export const metadata: Metadata = {
  title: "SSO sign-in — Mogplex",
  description: "Sign in to Mogplex with your organization's single sign-on.",
  robots: NO_INDEX_ROBOTS,
};

export default function SsoPage() {
  return <SsoPageClient />;
}
