import { describe, expect, it } from "vitest";
import { successTone } from "./stat-card-tone";

describe("successTone", () => {
  it("returns success at the >=95 boundary", () => {
    expect(successTone(95)).toBe("success");
    expect(successTone(100)).toBe("success");
  });

  it("returns warn at the >=80 boundary and just below success", () => {
    expect(successTone(94)).toBe("warn");
    expect(successTone(94.999)).toBe("warn");
    expect(successTone(80)).toBe("warn");
  });

  it("returns failure below the warn threshold", () => {
    expect(successTone(79)).toBe("failure");
    expect(successTone(79.999)).toBe("failure");
    expect(successTone(0)).toBe("failure");
  });
});
