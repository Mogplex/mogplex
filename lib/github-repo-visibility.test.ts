import { expect, it } from "vitest";
import { filterVisibleGithubRepos } from "./github-repo-visibility";

const approved = {
  github_id: 1,
  github_installation_id: 12,
  full_name: "approved/app",
};
const transferred = {
  github_id: 2,
  github_installation_id: 12,
  full_name: "unapproved/private",
};
const oauthOnly = {
  github_id: 3,
  github_installation_id: null,
  full_name: "unapproved/other",
};
it("excludes transferred and OAuth-only repositories from the current App grant", () => {
  expect(
    filterVisibleGithubRepos([approved, transferred, oauthOnly], {
      preferInstallationCoverage: true,
      authorizedGithubRepoIds: new Set([1]),
    })
  ).toEqual([approved]);
});
it("does not restore cached rows when the App has no current repository grants", () => {
  expect(
    filterVisibleGithubRepos([approved, oauthOnly], {
      preferInstallationCoverage: true,
      authorizedGithubRepoIds: new Set(),
    })
  ).toEqual([]);
  expect(
    filterVisibleGithubRepos([oauthOnly], { preferInstallationCoverage: true })
  ).toEqual([]);
});
it("retains explicitly supported OAuth-only inventories", () => {
  expect(
    filterVisibleGithubRepos([approved, oauthOnly], {
      preferInstallationCoverage: false,
    })
  ).toEqual([approved, oauthOnly]);
  expect(
    filterVisibleGithubRepos([approved, oauthOnly], {
      preferInstallationCoverage: true,
    })
  ).toEqual([approved]);
});
