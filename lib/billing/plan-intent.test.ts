import { describe, expect, it } from "vitest";
import {
  checkoutPath,
  parsePlanIntent,
  planIntentDisplayName,
  planIntentSummary,
  signupPath,
} from "./plan-intent";

describe("parsePlanIntent", () => {
  it("accepts exactly the three Individual plans", () => {
    expect(parsePlanIntent("pro")).toBe("pro");
    expect(parsePlanIntent("plus")).toBe("plus");
    expect(parsePlanIntent("max")).toBe("max");
  });

  it("rejects company, legacy, and empty values", () => {
    expect(parsePlanIntent("team")).toBeNull();
    expect(parsePlanIntent("business")).toBeNull();
    expect(parsePlanIntent("enterprise")).toBeNull();
    expect(parsePlanIntent("free")).toBeNull();
    expect(parsePlanIntent("")).toBeNull();
    expect(parsePlanIntent(null)).toBeNull();
  });
});

describe("plan intent", () => {
  it("preserves an Individual plan through signup and checkout", () => {
    expect(checkoutPath("plus")).toBe("/checkout?plan=plus");
    expect(signupPath("max")).toBe("/signup?plan=max");
    expect(signupPath(null)).toBe("/signup");
  });

  it("uses the canonical capacity catalog", () => {
    expect(planIntentDisplayName("max")).toBe("Max");
    expect(planIntentSummary("plus")).toEqual({
      tier: "plus",
      name: "Plus",
      monthlyPrice: "$100",
      annualPrice: "$1,020",
      concurrency: 25,
      retainedDataGb: 5,
      hostedUsage: "$25",
    });
  });
});
