import type { Metadata } from "next";
import { BillingSection } from "@/components/settings/billing-section";
import { getScopeContext } from "@/lib/scope-context";

export const metadata: Metadata = {
  title: "Billing | Mogplex",
  description: "Manage your Mogplex plan, capacity, and inference.",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function BillingSettingsPage() {
  await getScopeContext();
  return (
    <div className="min-h-full w-full max-w-[1488px] space-y-4 p-3 md:space-y-6 md:p-6">
      <h1 className="ui-page-title">Billing</h1>
      <BillingSection />
    </div>
  );
}
