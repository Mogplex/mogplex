import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildGithubRepoOwnerTargets,
  canCreatePrivateGithubOrgRepo,
  fetchGithubCurrentUserContext,
  fetchGithubCurrentUserLogin,
  filterCreatableGithubOrgLogins,
} from "./github-owners";

afterEach(() => {
  vi.restoreAllMocks();
});

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

  it("filters organizations through live settings and membership checks", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/orgs/broken")) {
        return new Response("unavailable", { status: 503 });
      }
      if (url.includes("/orgs/acme%20labs")) {
        return Response.json(
          url.includes("/user/memberships/")
            ? { state: "active", role: "admin" }
            : { members_can_create_repositories: false }
        );
      }
      return Response.json(
        url.includes("/user/memberships/")
          ? { state: "active", role: "member" }
          : { members_can_create_private_repositories: false }
      );
    });

    await expect(
      filterCreatableGithubOrgLogins("token", [
        "acme labs",
        "restricted",
        "broken",
      ])
    ).resolves.toEqual(["acme labs"]);
    expect(warning).toHaveBeenCalledOnce();
  });

  it("loads the current login and granted OAuth scopes together", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json(
        { login: " alex " },
        { headers: { "x-oauth-scopes": "repo, read:org, read:user" } }
      )
    );

    await expect(fetchGithubCurrentUserContext("token")).resolves.toEqual({
      login: "alex",
      oauthScopes: ["repo", "read:org", "read:user"],
    });
    await expect(fetchGithubCurrentUserLogin("token")).resolves.toBe("alex");
  });

  it("surfaces current-user lookup failures", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("forbidden", { status: 403 })
    );

    await expect(fetchGithubCurrentUserContext("token")).rejects.toThrow(
      "GitHub owner lookup failed (403): forbidden"
    );
  });
});
