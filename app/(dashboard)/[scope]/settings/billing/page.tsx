import type { Metadata } from "next";
import { BillingSection } from "@/components/settings/billing-section";
import { getScopeContext } from "@/lib/scope-context";
import { isSelfHostedMode } from "@/lib/self-hosted";

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
      {isSelfHostedMode() ? (
        <p className="text-sm text-muted-foreground" data-testid="self-hosted-billing-notice">
          Billing is turned off on this self-hosted deployment. The deployment
          operator provides model and sandbox access.
        </p>
      ) : (
        <BillingSection />
      )}
    </div>
  );
}
