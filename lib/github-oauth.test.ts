import { describe, expect, it } from "vitest";
import {
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
