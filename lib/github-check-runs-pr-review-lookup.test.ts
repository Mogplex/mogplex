import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getLatestPrReviewCheckRun,
  getPullRequestHeadSha,
} from "./github-check-runs";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getPullRequestHeadSha", () => {
  it("returns the PR head sha", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ head: { sha: "abc123" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getPullRequestHeadSha({
      githubToken: "token",
      repoFullName: "acme/widgets",
      prNumber: 12,
    });

    expect(result).toBe("abc123");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      "https://api.github.com/repos/acme/widgets/pulls/12"
    );
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer token"
    );
  });

  it("returns null when the PR is not found", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ message: "Not Found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await getPullRequestHeadSha({
      githubToken: "token",
      repoFullName: "acme/widgets",
      prNumber: 999,
    });

    expect(result).toBeNull();
  });

  it("returns null when the head sha is missing", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ head: {} }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getPullRequestHeadSha({
      githubToken: "token",
      repoFullName: "acme/widgets",
      prNumber: 12,
    });

    expect(result).toBeNull();
  });

  it("surfaces GitHub lookup failures", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ message: "Forbidden" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getPullRequestHeadSha({
        githubToken: "token",
        repoFullName: "acme/widgets",
        prNumber: 12,
      })
    ).rejects.toThrow(/GitHub pull request lookup failed \(403\): Forbidden/);
  });

  it("falls back to the status text when the error payload has no message", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("not-json", {
        status: 502,
        statusText: "Bad Gateway",
        headers: { "content-type": "text/plain" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getPullRequestHeadSha({
        githubToken: "token",
        repoFullName: "acme/widgets",
        prNumber: 12,
      })
    ).rejects.toThrow(/GitHub pull request lookup failed \(502\): Bad Gateway/);
  });
});

describe("getLatestPrReviewCheckRun", () => {
  it("returns the latest review check run", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ check_runs: [{ id: 42, external_id: "job-1" }] })
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await getLatestPrReviewCheckRun({
      githubToken: "token",
      repoFullName: "acme/widgets",
      headSha: "abc123",
    });

    expect(result).toEqual({ id: 42, externalId: "job-1" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      "https://api.github.com/repos/acme/widgets/commits/abc123/check-runs?check_name=Mogplex%20PR%20Review&per_page=1"
    );
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer token"
    );
  });

  it("returns null when no review check run exists", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ check_runs: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getLatestPrReviewCheckRun({
      githubToken: "token",
      repoFullName: "acme/widgets",
      headSha: "abc123",
    });

    expect(result).toBeNull();
  });

  it("returns a null externalId when none is linked", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ check_runs: [{ id: 42, external_id: "" }] })
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await getLatestPrReviewCheckRun({
      githubToken: "token",
      repoFullName: "acme/widgets",
      headSha: "abc123",
    });

    expect(result).toEqual({ id: 42, externalId: null });
  });

  it("surfaces GitHub lookup failures", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ message: "Forbidden" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getLatestPrReviewCheckRun({
        githubToken: "token",
        repoFullName: "acme/widgets",
        headSha: "abc123",
      })
    ).rejects.toThrow(/GitHub check runs lookup failed \(403\): Forbidden/);
  });

  it("falls back to the status text when the error payload has no message", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("not-json", {
        status: 502,
        statusText: "Bad Gateway",
        headers: { "content-type": "text/plain" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getLatestPrReviewCheckRun({
        githubToken: "token",
        repoFullName: "acme/widgets",
        headSha: "abc123",
      })
    ).rejects.toThrow(/GitHub check runs lookup failed \(502\): Bad Gateway/);
  });
});
