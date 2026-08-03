import type { Metadata } from "next";
import { NO_INDEX_ROBOTS } from "@/lib/seo";
import { BetaLoginClient } from "./beta-login-client";

export const metadata: Metadata = {
  title: "Beta sign-in — Mogplex",
  description: "Sign in to Mogplex with your private beta access code.",
  robots: NO_INDEX_ROBOTS,
};

export default function BetaLoginPage() {
  return <BetaLoginClient />;
}
