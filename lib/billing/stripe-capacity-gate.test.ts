import { afterEach, describe, expect, it, vi } from "vitest";
import { areCapacityBillingOperationsEnabled } from "./stripe";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Capacity billing operations gate", () => {
  it("requires an explicit feature flag and a Stripe test key", () => {
    vi.stubEnv("CAPACITY_BILLING_OPERATIONS_ENABLED", "true");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_example");
    expect(areCapacityBillingOperationsEnabled()).toBe(true);

    vi.stubEnv("CAPACITY_BILLING_OPERATIONS_ENABLED", "false");
    expect(areCapacityBillingOperationsEnabled()).toBe(false);
  });

  it("refuses live Stripe keys even when the feature flag is set", () => {
    vi.stubEnv("CAPACITY_BILLING_OPERATIONS_ENABLED", "true");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_example");
    expect(areCapacityBillingOperationsEnabled()).toBe(false);
  });
});
