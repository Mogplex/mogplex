import { afterEach, describe, expect, it, vi } from "vitest";

import {
  checkGithubRepoAvailability,
  fetchGithubRepo,
  isRecoverableGithubRepoCreateConflict,
} from "./github-create";

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

  it("only recovers fresh, effectively empty repositories", () => {
    const now = Date.parse("2026-08-14T18:00:00.000Z");
    const repo = {
      id: 42,
      full_name: "acme/widgets",
      created_at: "2026-08-14T17:55:00.000Z",
      size: 1,
    };

    expect(isRecoverableGithubRepoCreateConflict(repo, now)).toBe(true);
    expect(
      isRecoverableGithubRepoCreateConflict(
        { ...repo, created_at: "2026-08-14T17:49:59.000Z" },
        now
      )
    ).toBe(false);
    expect(
      isRecoverableGithubRepoCreateConflict({ ...repo, size: 2 }, now)
    ).toBe(false);
    expect(
      isRecoverableGithubRepoCreateConflict(
        { id: 43, full_name: "acme/unknown" },
        now
      )
    ).toBe(false);
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
