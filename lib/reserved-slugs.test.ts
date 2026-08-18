import { describe, expect, it } from "vitest";
import { isReservedSlug } from "./reserved-slugs";

describe("reserved workspace slugs", () => {
  it("reserves checkout without regard to case", () => {
    expect(isReservedSlug("checkout")).toBe(true);
    expect(isReservedSlug("CHECKOUT")).toBe(true);
  });
});
