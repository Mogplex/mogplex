import { describe, expect, it } from "vitest";

import {
  buildGithubRepoOwnerTargets,
  canCreatePrivateGithubOrgRepo,
} from "./github-owners";

describe("GitHub repository owners", () => {
  it("merges OAuth and installation scope without duplicates", () => {
    expect(
      buildGithubRepoOwnerTargets({
        githubUsername: "alex",
        installations: [
          {
            installation_id: 42,
            account_login: "acme",
            account_type: "Organization",
            target_type: "Organization",
          },
        ],
        orgLogins: ["acme"],
      })
    ).toEqual([
      {
        login: "alex",
        kind: "personal",
        github_installation_id: null,
        scope_label: "Personal",
        source: "oauth",
      },
      {
        login: "acme",
        kind: "org",
        github_installation_id: 42,
        scope_label: "Org",
        source: "oauth+installation",
      },
    ]);
  });

  it("allows active owners regardless of member policy", () => {
    expect(
      canCreatePrivateGithubOrgRepo(
        { members_can_create_repositories: false },
        { state: "active", role: "admin" }
      )
    ).toBe(true);
  });

  it("blocks pending members and members denied private repo creation", () => {
    expect(
      canCreatePrivateGithubOrgRepo(
        { members_can_create_repositories: true },
        { state: "pending", role: "member" }
      )
    ).toBe(false);
    expect(
      canCreatePrivateGithubOrgRepo(
        { members_can_create_private_repositories: false },
        { state: "active", role: "member" }
      )
    ).toBe(false);
  });
});
