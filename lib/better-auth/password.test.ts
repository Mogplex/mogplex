import { describe, expect, it } from "vitest";
import {
  hashAccountPassword,
  isAccountPasswordHash,
  verifyAccountPassword,
} from "./password";

describe("Better Auth password storage", () => {
  it("stores salted scrypt hashes and never the plaintext password", async () => {
    const password = "correct horse battery staple";

    const firstHash = await hashAccountPassword(password);
    const secondHash = await hashAccountPassword(password);

    expect(firstHash).not.toBe(password);
    expect(secondHash).not.toBe(password);
    expect(firstHash).not.toBe(secondHash);
    expect(isAccountPasswordHash(firstHash)).toBe(true);
    expect(isAccountPasswordHash(secondHash)).toBe(true);
    await expect(
      verifyAccountPassword({ hash: firstHash, password })
    ).resolves.toBe(true);
  });

  it("rejects plaintext and malformed stored values without throwing", async () => {
    await expect(
      verifyAccountPassword({
        hash: "correct horse battery staple",
        password: "correct horse battery staple",
      })
    ).resolves.toBe(false);
    await expect(
      verifyAccountPassword({ hash: "malformed", password: "irrelevant" })
    ).resolves.toBe(false);
  });
});
