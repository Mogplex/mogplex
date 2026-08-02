import type { Metadata } from "next";
import { PRIVATE_NO_INDEX_ROBOTS } from "@/lib/seo";
import { AuthErrorClient } from "./auth-error-client";

export const metadata: Metadata = {
  title: "Authentication error — Mogplex",
  robots: PRIVATE_NO_INDEX_ROBOTS,
};

export default function AuthErrorPage() {
  return <AuthErrorClient />;
}
