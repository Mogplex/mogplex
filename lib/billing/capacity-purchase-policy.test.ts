import { afterEach, describe, expect, it, vi } from "vitest";
import { CAPACITY_ADD_ONS } from "@/lib/billing/capacity-catalog";
import {
  canIncreaseCapacityAddOn,
  isCapacityBillingPilotAccount,
} from "@/lib/billing/capacity-purchase-policy";

const concurrency = CAPACITY_ADD_ONS.find(
  (addOn) => addOn.kind === "concurrency"
)!;
const storage = CAPACITY_ADD_ONS.find(
  (addOn) => addOn.kind === "retained_data"
)!;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("capacity billing pilot policy", () => {
  it("fails closed when no account allowlist is configured", () => {
    vi.stubEnv("CAPACITY_BILLING_PILOT_ACCOUNT_IDS", "");

    expect(isCapacityBillingPilotAccount("account-1")).toBe(false);
    expect(
      canIncreaseCapacityAddOn({ accountId: "account-1", addOn: concurrency })
    ).toBe(false);
  });

  it("matches trimmed account ids exactly", () => {
    vi.stubEnv(
      "CAPACITY_BILLING_PILOT_ACCOUNT_IDS",
      " account-1,account-20, account-1 "
    );

    expect(isCapacityBillingPilotAccount("account-1")).toBe(true);
    expect(isCapacityBillingPilotAccount("account-2")).toBe(false);
  });

  it("keeps storage available while reserving concurrency increases for pilots", () => {
    vi.stubEnv("CAPACITY_BILLING_PILOT_ACCOUNT_IDS", "pilot-account");

    expect(
      canIncreaseCapacityAddOn({ accountId: "regular-account", addOn: storage })
    ).toBe(true);
    expect(
      canIncreaseCapacityAddOn({
        accountId: "regular-account",
        addOn: concurrency,
      })
    ).toBe(false);
    expect(
      canIncreaseCapacityAddOn({
        accountId: "pilot-account",
        addOn: concurrency,
      })
    ).toBe(true);
  });
});
