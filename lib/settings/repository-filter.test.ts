import { describe, expect, it } from "vitest";
import {
  activeOwnerRepos,
  filterRepositories,
  groupRepositoriesByOwner,
  repoOwner,
  splitByAppConnection,
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
  });

  it("should filter by owner and case-insensitive search", () => {
    const result = filterRepositories(REPOS, {
      owner: "alex",
      search: " ALP ",
    });

    expect(result.connected.map((r) => r.full_name)).toEqual(["alex/alpha"]);
  });

  it("should return every connected repository of the owner regardless of search", () => {
    expect(activeOwnerRepos(REPOS, "alex").map((r) => r.full_name)).toEqual([
      "alex/zeta",
      "alex/alpha",
    ]);
  });

  it("should prefer the stored owner over the name prefix", () => {
    expect(repoOwner(repo("old-name/app", false, "new-name"))).toBe("new-name");
    expect(repoOwner(repo("acme/app"))).toBe("acme");
  });
});

describe("splitByAppConnection", () => {
  const row = (
    full_name: string,
    github_app_covered: boolean,
    github_prefer_installation_coverage = true,
    is_hidden = false
  ) => ({
    full_name,
    github_app_covered,
    github_prefer_installation_coverage,
    is_hidden,
  });

  it("should keep only App-installed repositories when the account prefers App coverage", () => {
    const { inventory, notConnected } = splitByAppConnection([
      row("me/app", true),
      row("skhard99/docs", false),
    ]);

    expect(inventory.map((r) => r.full_name)).toEqual(["me/app"]);
    expect(notConnected.map((r) => r.full_name)).toEqual(["skhard99/docs"]);
  });

  it("should keep every repository once every covered repository is removed", () => {
    const { inventory, notConnected } = splitByAppConnection([
      row("me/app", true, true, true),
      row("skhard99/docs", false),
    ]);

    expect(inventory).toHaveLength(2);
    expect(notConnected).toEqual([]);
  });

  it("should keep every repository while no repository is covered yet", () => {
    const { inventory, notConnected } = splitByAppConnection([
      row("me/app", false),
      row("me/other", false),
    ]);

    expect(inventory).toHaveLength(2);
    expect(notConnected).toEqual([]);
  });

  it("should keep every repository on an OAuth-only deployment", () => {
    const { inventory, notConnected } = splitByAppConnection([
      row("me/app", false, false),
      row("me/other", false, false),
    ]);

    expect(inventory).toHaveLength(2);
    expect(notConnected).toEqual([]);
  });
});

describe("groupRepositoriesByOwner", () => {
  const row = (full_name: string) => ({ full_name, owner: "" });

  it("should list the signed-in account first, then other owners by name, keeping repository order", () => {
    const groups = groupRepositoriesByOwner(
      [row("zed/b"), row("Me/z"), row("acme/x"), row("zed/a")],
      "me"
    );

    expect(groups.map((g) => g.owner)).toEqual(["Me", "acme", "zed"]);
    expect(groups[2].repos.map((r) => r.full_name)).toEqual(["zed/b", "zed/a"]);
  });

  it("should sort every owner by name without a signed-in login", () => {
    const groups = groupRepositoriesByOwner([row("zed/a"), row("acme/x")]);

    expect(groups.map((g) => g.owner)).toEqual(["acme", "zed"]);
  });
});
