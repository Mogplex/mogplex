import { afterEach, describe, expect, it, vi } from "vitest";

import { checkGithubRepoAvailability } from "./github-create";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GitHub repository availability", () => {
  it.each([
    [404, "available"],
    [200, "taken"],
    [403, "unverified"],
    [429, "unverified"],
  ] as const)("maps GitHub status %s to %s", async (status, expected) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status }))
    );

    await expect(
      checkGithubRepoAvailability("token", "acme", "widgets")
    ).resolves.toBe(expected);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.github.com/repos/acme/widgets",
      expect.objectContaining({ cache: "no-store" })
    );
  });

  it("surfaces unexpected provider failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("upstream failed", { status: 500 }))
    );

    await expect(
      checkGithubRepoAvailability("token", "acme", "widgets")
    ).rejects.toThrow(
      "GitHub repo availability check failed (500): upstream failed"
    );
  });
});
