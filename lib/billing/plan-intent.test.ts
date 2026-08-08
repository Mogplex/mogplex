import { describe, expect, it } from "vitest";
import {
  checkoutPath,
  parsePlanIntent,
  planIntentDisplayName,
  planIntentSummary,
  signupPath,
} from "./plan-intent";

describe("parsePlanIntent", () => {
  it("should accept exactly the three paid tiers", () => {
    expect(parsePlanIntent("pro")).toBe("pro");
    expect(parsePlanIntent("team")).toBe("team");
    expect(parsePlanIntent("business")).toBe("business");
  });

  it("should reject unknown, display-name, and empty values", () => {
    expect(parsePlanIntent("mog-mode")).toBeNull();
    expect(parsePlanIntent("Mog Mode")).toBeNull();
    expect(parsePlanIntent("enterprise")).toBeNull();
    expect(parsePlanIntent("free")).toBeNull();
    expect(parsePlanIntent("")).toBeNull();
    expect(parsePlanIntent(null)).toBeNull();
    expect(parsePlanIntent(undefined)).toBeNull();
  });
});

describe("plan intent paths", () => {
  it("should build checkout and signup paths from the tier key", () => {
    expect(checkoutPath("team")).toBe("/checkout?plan=team");
    expect(signupPath("business")).toBe("/signup?plan=business");
  });

  it("should fall back to plain signup when no plan was chosen", () => {
    expect(signupPath(null)).toBe("/signup");
  });
});

describe("planIntentSummary", () => {
  it("should render the business tier as Mog Mode with catalog prices", () => {
    const summary = planIntentSummary("business");
    expect(summary.name).toBe("Mog Mode");
    expect(summary.monthlyLookupKey).toBe("business_monthly");
    expect(summary.annualLookupKey).toBe("business_annual");
    expect(summary.monthlyPrice).toBe("$200.00");
    expect(summary.includedUsage).toBe("$200.00");
  });

  it("should expose monthly and annual catalog prices for every tier", () => {
    for (const tier of ["pro", "team", "business"] as const) {
      const summary = planIntentSummary(tier);
      expect(summary.tier).toBe(tier);
      expect(summary.name).toBe(planIntentDisplayName(tier));
      expect(summary.monthlyPrice).toMatch(/^\$\d+\.\d{2}$/);
      expect(summary.annualPrice).toMatch(/^\$\d+\.\d{2}$/);
    }
  });
});
