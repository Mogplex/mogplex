import type { Metadata } from "next";
import { BillingSection } from "@/components/settings/billing-section";

export const metadata: Metadata = {
  title: "Billing | Mogplex",
  description: "Manage your Mogplex plan, balance, and top-ups.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function BillingSettingsPage() {
  return (
    <div className="mx-auto w-full max-w-3xl p-6">
      <h1 className="mb-6 text-xl font-semibold">Billing</h1>
      <BillingSection />
    </div>
  );
}
