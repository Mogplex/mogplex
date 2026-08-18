import type { CapacityAddOn } from "@/lib/billing/capacity-catalog";

export function isCapacityBillingPilotAccount(accountId: string): boolean {
  const configured = process.env.CAPACITY_BILLING_PILOT_ACCOUNT_IDS;
  if (!configured) return false;

  return configured
    .split(",")
    .some((candidate) => candidate.trim() === accountId);
}

export function canIncreaseCapacityAddOn(input: {
  accountId: string;
  addOn: CapacityAddOn;
  pilotAccount?: boolean;
}): boolean {
  return (
    input.addOn.kind !== "concurrency" ||
    (input.pilotAccount ?? isCapacityBillingPilotAccount(input.accountId))
  );
}
