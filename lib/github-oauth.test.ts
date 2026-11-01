import { describe, expect, it } from "vitest";
import {
  getGithubOAuthGrantConfiguration,
  GITHUB_OAUTH_SCOPES,
  GITHUB_OAUTH_SCOPE,
  GITHUB_ORG_READ_SCOPE,
  GITHUB_REAUTHORIZE_HEADER,
} from "./github-oauth";

describe("GitHub OAuth scopes", () => {
  it("requests organization membership needed for owner discovery", () => {
    expect(GITHUB_OAUTH_SCOPES).toContain("read:org");
    expect(GITHUB_ORG_READ_SCOPE).toBe("read:org");
    expect(GITHUB_REAUTHORIZE_HEADER).toBe("x-mogplex-github-reauthorize");
    expect(GITHUB_OAUTH_SCOPE.split(" ")).toEqual(GITHUB_OAUTH_SCOPES);
  });
});

it("keeps App reconnection limited to identity and membership and preserves App mode", () => {
  const grant = getGithubOAuthGrantConfiguration(true);
  expect(grant.repositoryAuthMode).toBe("app");
  expect(grant.scope.split(" ")).toEqual([
    "read:org",
    "read:user",
    "user:email",
  ]);
});
it("retains the explicit repository grant for an OAuth-only deployment", () => {
  const grant = getGithubOAuthGrantConfiguration(false);
  expect(grant.repositoryAuthMode).toBe("oauth");
  expect(grant.scope.split(" ")).toContain("repo");
});
