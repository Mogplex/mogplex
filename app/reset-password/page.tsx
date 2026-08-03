import type { Metadata } from "next";
import { NO_INDEX_ROBOTS } from "@/lib/seo";
import { ResetPasswordPageClient } from "./reset-password-page-client";

export const metadata: Metadata = {
  title: "Choose a new password — Mogplex",
  description: "Choose a new password for your Mogplex account.",
  robots: NO_INDEX_ROBOTS,
};

export default function ResetPasswordPage() {
  return <ResetPasswordPageClient />;
}
