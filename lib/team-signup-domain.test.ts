import { describe, expect, it } from "vitest";
import { verifiedWorkEmailDomain } from "./team-signup-domain";

describe("verified work email domains", () => {
  it("uses the exact verified domain, normalized to lowercase", () => {
    expect(verifiedWorkEmailDomain("owner@EXAMPLE.COM", true)).toBe(
      "example.com"
    );
    expect(verifiedWorkEmailDomain("owner@staff.example.com", true)).toBe(
      "staff.example.com"
    );
  });
  it("rejects unverified, malformed and shared email addresses", () => {
    for (const email of [
      null,
      "missing",
      "a@b@example.com",
      "a@example.com.",
      "a@exa_mple.com",
      "a@GMAIL.COM",
      "a@outlook.com",
    ]) {
      expect(verifiedWorkEmailDomain(email, true)).toBeNull();
    }
    expect(verifiedWorkEmailDomain("owner@example.com", false)).toBeNull();
  });
});
