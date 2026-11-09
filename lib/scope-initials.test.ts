import { describe, expect, it } from "vitest";
import { scopeInitials } from "./scope-initials";

describe("scopeInitials", () => {
  it("should use the first letters of the first and last words", () => {
    expect(scopeInitials("Acme Operations Team")).toBe("AT");
  });

  it("should use the first two letters of a single word", () => {
    expect(scopeInitials("webrenew")).toBe("WE");
  });

  it("should fall back to a question mark for a blank name", () => {
    expect(scopeInitials("   ")).toBe("?");
  });

  it("should keep an emoji whole when it starts a word", () => {
    expect(scopeInitials("🚀 Launch")).toBe("🚀L");
    expect(scopeInitials("🚀")).toBe("🚀");
  });
});
