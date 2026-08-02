import assert from "node:assert/strict";
import test from "node:test";

async function loadGithubAccessHelpers() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../lib/github-access");
}

test("getOwnedRepoWithGithubAccessToken does not resolve a token for an unowned repo", async () => {
  const { getOwnedRepoWithGithubAccessToken } = await loadGithubAccessHelpers();
  let tokenLookups = 0;

  const result = await getOwnedRepoWithGithubAccessToken(
    "repo-123",
    "user-123",
    {
      select: "*",
      loadRepo: async () => null,
      loadGithubAccessToken: async () => {
        tokenLookups += 1;
        return "github-token";
      },
    }
  );

  assert.deepEqual(result, { repo: null, githubToken: null });
  assert.equal(tokenLookups, 0);
});

test("getOwnedRepoWithGithubAccessToken returns the owned repo and its token", async () => {
  const { getOwnedRepoWithGithubAccessToken } = await loadGithubAccessHelpers();
  const repo = {
    id: "repo-123",
    user_id: "user-123",
    github_installation_id: 99,
  };
  let seenSelect: string | null = null;

  const result = await getOwnedRepoWithGithubAccessToken(
    "repo-123",
    "user-123",
    {
      select: "id, user_id, github_installation_id",
      loadRepo: async (repoId, userId, select) => {
        assert.equal(repoId, "repo-123");
        assert.equal(userId, "user-123");
        seenSelect = select;
        return repo;
      },
      loadGithubAccessToken: async (inputRepo) => {
        assert.equal(inputRepo, repo);
        return "github-token";
      },
    }
  );

  assert.equal(seenSelect, "id, user_id, github_installation_id");
  assert.equal(result.repo, repo);
  assert.equal(result.githubToken, "github-token");
});
