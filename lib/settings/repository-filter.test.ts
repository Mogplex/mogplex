import { describe, expect, it } from "vitest";
import { filterRepositories, repoOwner } from "./repository-filter";

const repo = (full_name: string, is_hidden = false, owner = "") => ({
  full_name,
  is_hidden,
  owner,
});

const REPOS = [
  repo("alex/zeta"),
  repo("alex/alpha"),
  repo("alex/old", true),
  repo("acme/app"),
];

describe("filterRepositories", () => {
  it("should split connected and removed repositories in name order", () => {
    const result = filterRepositories(REPOS, { owner: "all", search: "" });

    expect(result.connected.map((r) => r.full_name)).toEqual([
      "acme/app",
      "alex/alpha",
      "alex/zeta",
    ]);
    expect(result.removed.map((r) => r.full_name)).toEqual(["alex/old"]);
    expect(result.removedTotal).toBe(1);
  });

  it("should filter by owner and case-insensitive search", () => {
    const result = filterRepositories(REPOS, {
      owner: "alex",
      search: " ALP ",
    });

    expect(result.connected.map((r) => r.full_name)).toEqual(["alex/alpha"]);
  });

  it("should count every connected repository of the owner regardless of search", () => {
    const result = filterRepositories(REPOS, {
      owner: "alex",
      search: "no-such-repo",
    });

    expect(result.connected).toEqual([]);
    expect(result.ownerConnectedCount).toBe(2);
  });

  it("should prefer the stored owner over the name prefix", () => {
    expect(repoOwner(repo("old-name/app", false, "new-name"))).toBe("new-name");
    expect(repoOwner(repo("acme/app"))).toBe("acme");
  });
});
