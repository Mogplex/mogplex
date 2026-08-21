import { getResolvedAuth, getUserId } from "./auth";
import { describe, expect, it, vi } from "vitest";

describe("getResolvedAuth CLI bearer priority", () => {
  it("returns resolved CLI OAuth before browser auth strategies", async () => {
    const getHeaders = vi.fn().mockResolvedValue({
      get: vi.fn((name: string) =>
        name === "authorization" ? "Bearer oauth-token" : null
      ),
    });
    const resolveCliBearer = vi.fn().mockResolvedValue({
      profileId: "profile-1",
      source: "oauth",
    });

    const dependencies = { getHeaders, resolveCliBearer };

    await expect(getResolvedAuth(dependencies)).resolves.toEqual({
      profileId: "profile-1",
      authUserId: null,
      source: "oauth",
    });
    await expect(getUserId(dependencies)).resolves.toBe("profile-1");
    expect(resolveCliBearer).toHaveBeenCalledWith("Bearer oauth-token");
  });
});
