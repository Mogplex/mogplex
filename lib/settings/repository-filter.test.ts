import { describe, expect, it } from "vitest";
import {
  filterRepositories,
  groupRepositoriesByOwner,
  repoOwner,
} from "./repository-filter";

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

describe("groupRepositoriesByOwner", () => {
  const row = (
    full_name: string,
    github_installation_id: number | null,
    is_hidden = false
  ) => ({ full_name, owner: "", github_installation_id, is_hidden });

  it("should group visible repositories by owner and keep their order", () => {
    const repos = [row("zed/b", 1), row("acme/z", 2), row("zed/a", 1)];
    const groups = groupRepositoriesByOwner(repos, repos);

    expect(groups.map((g) => g.owner)).toEqual(["acme", "zed"]);
    expect(groups[1].repos.map((r) => r.full_name)).toEqual(["zed/b", "zed/a"]);
  });

  it("should classify owners as connected, partly connected, or not connected", () => {
    const repos = [
      row("legacy/docs", null),
      row("mixed/a", null),
      row("mixed/b", 7),
      row("app/x", 3),
    ];
    const groups = groupRepositoriesByOwner(repos, repos);

    expect(groups.map((g) => [g.owner, g.coverage])).toEqual([
      ["app", "connected"],
      ["mixed", "partial"],
      ["legacy", "none"],
    ]);
    expect(groups[1].notConnected.map((r) => r.full_name)).toEqual(["mixed/a"]);
  });

  it("should judge coverage from every connected repository of the owner, not only the visible ones", () => {
    const all = [row("mixed/alpha", 11), row("mixed/beta", null)];
    const [group] = groupRepositoriesByOwner([all[1]], all);

    expect(group.repos.map((r) => r.full_name)).toEqual(["mixed/beta"]);
    expect(group.coverage).toBe("partial");
    expect(group.notConnected.map((r) => r.full_name)).toEqual(["mixed/beta"]);
  });

  it("should ignore removed repositories when judging coverage", () => {
    const all = [row("legacy/docs", null), row("legacy/old", 4, true)];
    const [group] = groupRepositoriesByOwner([all[0]], all);

    expect(group.coverage).toBe("none");
  });
});
