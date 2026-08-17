import type { Metadata } from "next";
import { NO_INDEX_ROBOTS } from "@/lib/seo";
import { CheckoutPageClient } from "./checkout-page-client";

export const metadata: Metadata = {
  title: "Checkout | Mogplex",
  description: "Confirm your plan and continue to secure checkout.",
  robots: NO_INDEX_ROBOTS,
};

export default function CheckoutPage() {
  return <CheckoutPageClient />;
}
