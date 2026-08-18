import { describe, expect, it } from "vitest";
import {
  isPublicRoutePath,
  isUnscopedAuthedRoutePath,
} from "./auth-route-policy";

describe("authenticated root route policy", () => {
  it("keeps checkout authenticated and outside workspace scope resolution", () => {
    expect(isPublicRoutePath("/checkout")).toBe(false);
    expect(isUnscopedAuthedRoutePath("/checkout")).toBe(true);
    expect(isUnscopedAuthedRoutePath("/checkout/complete")).toBe(true);
    expect(isUnscopedAuthedRoutePath("/checkout-old")).toBe(false);
  });
});
