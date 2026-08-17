import { afterEach, describe, expect, it, vi } from "vitest";
import {
  areCapacityBillingOperationsEnabled,
  capacityBillingStripeMode,
} from "./stripe";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Capacity billing operations gate", () => {
  it("requires an explicit feature flag and a Stripe test key", () => {
    vi.stubEnv("CAPACITY_BILLING_OPERATIONS_ENABLED", "true");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_example");
    expect(areCapacityBillingOperationsEnabled()).toBe(true);
    expect(capacityBillingStripeMode()).toBe("test");

    vi.stubEnv("CAPACITY_BILLING_OPERATIONS_ENABLED", "false");
    expect(areCapacityBillingOperationsEnabled()).toBe(false);
  });

  it("requires a separate explicit switch for live Stripe writes", () => {
    vi.stubEnv("CAPACITY_BILLING_OPERATIONS_ENABLED", "true");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_example");
    expect(areCapacityBillingOperationsEnabled()).toBe(false);

    vi.stubEnv("CAPACITY_BILLING_LIVE_WRITES_ENABLED", "true");
    expect(areCapacityBillingOperationsEnabled()).toBe(true);
    expect(capacityBillingStripeMode()).toBe("live");

    vi.stubEnv("CAPACITY_BILLING_OPERATIONS_ENABLED", "false");
    expect(areCapacityBillingOperationsEnabled()).toBe(false);
  });
});
