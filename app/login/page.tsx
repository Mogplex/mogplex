import type { Metadata } from "next";
import { NO_INDEX_ROBOTS } from "@/lib/seo";
import { LoginPageClient } from "./login-page-client";

export const metadata: Metadata = {
  title: "Sign in — Mogplex",
  description: "Sign in to Mogplex with your private beta access code.",
  robots: NO_INDEX_ROBOTS,
};

export default function LoginPage() {
  return <LoginPageClient />;
}
