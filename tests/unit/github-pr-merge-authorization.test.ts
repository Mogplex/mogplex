import assert from "node:assert/strict";
import test from "node:test";
import { deriveGithubPullRequestMergeAuthorization } from "@/lib/agents/tools/github-pr-merge";

test("derives merge consent only from an explicit request with an exact target", () => {
  assert.deepEqual(
    deriveGithubPullRequestMergeAuthorization({
      userText: "Please merge PR #84 in acme/widgets",
    }),
    { owner: "acme", repo: "widgets", number: 84 }
  );
  assert.deepEqual(
    deriveGithubPullRequestMergeAuthorization({
      userText: "Can you merge https://github.com/acme/widgets/pull/84?",
    }),
    { owner: "acme", repo: "widgets", number: 84 }
  );
});

test("does not authorize ambiguous, informational, or negative requests", () => {
  assert.equal(
    deriveGithubPullRequestMergeAuthorization({
      userText: "Merge it",
      repoOwner: "acme",
      repoName: "widgets",
    }),
    null
  );
  assert.equal(
    deriveGithubPullRequestMergeAuthorization({
      userText: "Is PR #84 in acme/widgets ready to merge?",
    }),
    null
  );
  assert.equal(
    deriveGithubPullRequestMergeAuthorization({
      userText: "Do not merge PR #84 in acme/widgets",
    }),
    null
  );
});

test("allows an exact contextual PR only when the request is an instruction", () => {
  assert.deepEqual(
    deriveGithubPullRequestMergeAuthorization({
      userText: "Merge PR #84",
      repoOwner: "acme",
      repoName: "widgets",
    }),
    { owner: "acme", repo: "widgets", number: 84 }
  );
});
