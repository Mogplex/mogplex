import assert from "node:assert/strict";
import test from "node:test";

async function loadGithubOwnersHelpers() {
  return import("../../lib/github-owners");
}

test("buildGithubRepoOwnerTargets merges personal, org, and installation-backed accounts", async () => {
  const { buildGithubRepoOwnerTargets } = await loadGithubOwnersHelpers();

  const targets = buildGithubRepoOwnerTargets({
    githubUsername: "alex",
    installations: [
      {
        installation_id: 44,
        account_login: "acme",
        account_type: "Organization",
        target_type: "Organization",
      },
      {
        installation_id: 55,
        account_login: "alex",
        account_type: "User",
        target_type: "User",
      },
    ],
    orgLogins: ["acme", "labs"],
  });

  assert.deepEqual(targets, [
    {
      login: "alex",
      kind: "personal",
      github_installation_id: 55,
      scope_label: "Personal",
      source: "oauth+installation",
    },
    {
      login: "acme",
      kind: "org",
      github_installation_id: 44,
      scope_label: "Org",
      source: "oauth+installation",
    },
    {
      login: "labs",
      kind: "org",
      github_installation_id: null,
      scope_label: "Org",
      source: "oauth",
    },
  ]);
});
