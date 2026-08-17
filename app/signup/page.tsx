import type { Metadata } from "next";
import { NO_INDEX_ROBOTS } from "@/lib/seo";
import { SignupPageClient } from "./signup-page-client";

export const metadata: Metadata = {
  title: "Start now | Mogplex",
  description:
    "Create a Mogplex account, then confirm the Individual plan and capacity you chose.",
  robots: NO_INDEX_ROBOTS,
};

export default function SignupPage() {
  return <SignupPageClient />;
}
