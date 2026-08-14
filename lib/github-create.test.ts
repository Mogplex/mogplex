import { afterEach, describe, expect, it, vi } from "vitest";

import { checkGithubRepoAvailability, fetchGithubRepo } from "./github-create";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GitHub repository lookup", () => {
  it("returns an existing repository for idempotent create recovery", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ id: 42, full_name: "acme/widgets" }))
    );

    await expect(fetchGithubRepo("token", "acme", "widgets")).resolves.toEqual({
      id: 42,
      full_name: "acme/widgets",
    });
  });

  it("distinguishes a missing repository from provider failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response("", { status: 404 }))
        .mockResolvedValueOnce(new Response("upstream", { status: 500 }))
    );

    await expect(
      fetchGithubRepo("token", "acme", "missing")
    ).resolves.toBeNull();
    await expect(fetchGithubRepo("token", "acme", "broken")).rejects.toThrow(
      "GitHub repo lookup failed (500): upstream"
    );
  });
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
