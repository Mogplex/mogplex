import type { Metadata } from "next";
import { NO_INDEX_ROBOTS } from "@/lib/seo";
import { SignupPageClient } from "./signup-page-client";

export const metadata: Metadata = {
  title: "Start now — Mogplex",
  description:
    "Create a Mogplex account, connect a repo, and wire your first pipeline. PAYG has no monthly fee.",
  robots: NO_INDEX_ROBOTS,
};

export default function SignupPage() {
  return <SignupPageClient />;
}
