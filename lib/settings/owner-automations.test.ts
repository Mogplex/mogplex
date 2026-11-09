import { describe, expect, it } from "vitest";
import type { FlowStartFilter } from "@/lib/types";
import {
  automationsForOwner,
  installationForOwner,
  latestRepoSync,
  type RepoAutomation,
} from "./owner-automations";

const automationsOf = (
  entries: Array<[id: string, filter: FlowStartFilter | undefined]>
): RepoAutomation[] =>
  entries.map(([id, filter]) => ({ id, name: id, filter }));

describe("automationsForOwner", () => {
  const repos = [
    { full_name: "acme/app", github_installation_id: 7 },
    { full_name: "acme/site", github_installation_id: 7 },
  ];

  it("should match automations whose trigger filter accepts any of the owner's repositories", () => {
    const automations = automationsOf([
      ["all", { scope: "all", authorFilter: "dependabot_only" }],
      ["orgs", { scope: "org" }],
      ["personal", { scope: "personal" }],
      ["site-only", { scope: "all", repos: ["acme/site"] }],
      ["other-repo", { scope: "all", repos: ["zed/x"] }],
      ["other-install", { scope: "all", installationIds: [9] }],
    ]);

    expect(
      automationsForOwner(automations, repos, "Organization").map((a) => a.id)
    ).toEqual(["all", "orgs", "site-only"]);
  });

  it("should treat an unknown account type as a personal account, as the router does", () => {
    const automations = automationsOf([
      ["orgs", { scope: "org" }],
      ["personal", { scope: "personal" }],
    ]);

    for (const accountType of [null, undefined, "Bot"]) {
      expect(
        automationsForOwner(automations, repos, accountType).map((a) => a.id)
      ).toEqual(["personal"]);
    }
  });

  it("should match nothing for repositories without an installation", () => {
    const automations = automationsOf([["all", { scope: "all" }]]);

    expect(
      automationsForOwner(
        automations,
        [{ full_name: "legacy/docs", github_installation_id: null }],
        "User"
      )
    ).toEqual([]);
  });
});

describe("installationForOwner", () => {
  const installations = new Map([
    [7, { account_login: "acme", manage_url: "https://example.test/7" }],
  ]);

  it("should return the first known installation behind the owner's repositories", () => {
    expect(
      installationForOwner(
        "zed",
        [
          { github_installation_id: null },
          { github_installation_id: 9 },
          { github_installation_id: 7 },
        ],
        installations
      )?.manage_url
    ).toBe("https://example.test/7");
  });

  it("should prefer the installation whose account is the owner", () => {
    const byId = new Map([
      ...installations,
      [8, { account_login: "New-Owner", manage_url: "https://example.test/8" }],
    ]);

    expect(
      installationForOwner("new-owner", [{ github_installation_id: 7 }], byId)
        ?.manage_url
    ).toBe("https://example.test/8");
  });

  it("should return null when no repository carries a known installation", () => {
    expect(installationForOwner("zed", [], installations)).toBeNull();
    expect(
      installationForOwner(
        "zed",
        [{ github_installation_id: null }],
        installations
      )
    ).toBeNull();
    expect(
      installationForOwner(
        "zed",
        [{ github_installation_id: 9 }],
        installations
      )
    ).toBeNull();
  });
});

describe("latestRepoSync", () => {
  it("should return the most recent sync time across installations", () => {
    expect(
      latestRepoSync([
        { repos_synced_at: "2026-11-09T10:00:00Z" },
        { repos_synced_at: null },
        { repos_synced_at: "2026-11-09T12:00:00Z" },
      ])
    ).toBe("2026-11-09T12:00:00Z");
    expect(latestRepoSync([{ repos_synced_at: null }])).toBeNull();
  });
});
