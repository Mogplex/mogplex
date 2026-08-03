import type { Metadata } from "next";
import { NO_INDEX_ROBOTS } from "@/lib/seo";
import { SignupPageClient } from "./signup-page-client";

export const metadata: Metadata = {
  title: "Create account — Mogplex",
  description:
    "Create a Mogplex account with your email and password, GitHub, Google, or Microsoft.",
  robots: NO_INDEX_ROBOTS,
};

export default function SignupPage() {
  return <SignupPageClient />;
}
