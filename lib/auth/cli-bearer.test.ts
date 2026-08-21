import { describe, expect, it, vi } from "vitest";
import { resolveCliBearerAuth } from "@/lib/auth/cli-bearer";

describe("resolveCliBearerAuth", () => {
  it("ignores requests without a bearer token", async () => {
    const resolveApiKey = vi.fn();
    const resolveOAuthToken = vi.fn();

    await expect(
      resolveCliBearerAuth(null, { resolveApiKey, resolveOAuthToken })
    ).resolves.toBeUndefined();
    expect(resolveApiKey).not.toHaveBeenCalled();
    expect(resolveOAuthToken).not.toHaveBeenCalled();
  });

  it("resolves legacy CLI PATs", async () => {
    const resolveApiKey = vi.fn().mockResolvedValue({
      ok: true,
      auth: {
        userId: "profile-1",
        keyId: "key-1",
        scopes: ["read"],
      },
    });

    await expect(
      resolveCliBearerAuth("Bearer mog_test", { resolveApiKey })
    ).resolves.toEqual({ profileId: "profile-1", source: "api-key" });
  });

  it("resolves CLI OAuth tokens with read and write scopes", async () => {
    const resolveOAuthToken = vi.fn().mockResolvedValue({
      ok: true,
      auth: {
        userId: "profile-1",
        keyId: "mogplex-cli",
        scopes: ["read", "write"],
      },
    });

    await expect(
      resolveCliBearerAuth("Bearer oauth-token", { resolveOAuthToken })
    ).resolves.toEqual({ profileId: "profile-1", source: "oauth" });
  });

  it.each([
    { keyId: "another-client", scopes: ["read", "write"] },
    { keyId: "mogplex-cli", scopes: ["read"] },
    { keyId: "mogplex-cli", scopes: ["write"] },
  ])("rejects an OAuth token that is not valid for the CLI", async (auth) => {
    const resolveOAuthToken = vi.fn().mockResolvedValue({
      ok: true,
      auth: { userId: "profile-1", ...auth },
    });

    await expect(
      resolveCliBearerAuth("Bearer oauth-token", { resolveOAuthToken })
    ).resolves.toBeUndefined();
  });

  it("rejects invalid bearer tokens", async () => {
    const resolveOAuthToken = vi.fn().mockResolvedValue({
      ok: false,
      reason: "invalid",
    });

    await expect(
      resolveCliBearerAuth("Bearer invalid", { resolveOAuthToken })
    ).resolves.toBeUndefined();
  });
});
