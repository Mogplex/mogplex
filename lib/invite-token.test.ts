import { describe, expect, it } from "vitest";
import { generateInviteToken } from "./invite-token";

describe("generateInviteToken", () => {
  it("produces a 32-character base64url string", () => {
    const token = generateInviteToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it("does not collide across many invocations", () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 1000; i++) tokens.add(generateInviteToken());
    expect(tokens.size).toBe(1000);
  });
});
