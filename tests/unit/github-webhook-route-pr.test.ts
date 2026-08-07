import assert from "node:assert/strict";
import test from "node:test";
import { loadGithubWebhookRoute } from "./helpers/github-webhook-route-fixtures";

test("handlePullRequest includes branch metadata for fixer handoff", async () => {
  const { handlePullRequest } = await loadGithubWebhookRoute();

  const results = handlePullRequest({
    action: "opened",
    pull_request: {
      number: 42,
      html_url: "https://github.com/webrenew/credit-renew/pull/42",
      title: "Fix race condition",
      user: { login: "octocat", type: "User" },
      head: {
        ref: "fix/race-condition",
        sha: "abc123",
        repo: { full_name: "octocat/credit-renew-fork" },
      },
      base: {
        ref: "main",
        sha: "def456",
        repo: { full_name: "webrenew/credit-renew" },
      },
    },
  });

  assert.deepEqual(results, [
    {
      assignmentType: "pr_review",
      triggerEvent: "pr_opened",
      metadata: {
        pr_number: 42,
        pr_url: "https://github.com/webrenew/credit-renew/pull/42",
        pr_title: "Fix race condition",
        pr_author: "octocat",
        head_ref: "fix/race-condition",
        head_sha: "abc123",
        head_repo_full_name: "octocat/credit-renew-fork",
        base_ref: "main",
        base_sha: "def456",
        base_repo_full_name: "webrenew/credit-renew",
      },
      authorLogin: "octocat",
      authorIsBot: false,
    },
  ]);
});

test("handlePullRequest triggers reviews when a draft becomes ready and when a PR is reopened", async () => {
  const { handlePullRequest } = await loadGithubWebhookRoute();

  const draftOpenedResults = handlePullRequest({
    action: "opened",
    pull_request: {
      number: 42,
      html_url: "https://github.com/webrenew/credit-renew/pull/42",
      title: "Draft fix",
      draft: true,
    },
  });

  const draftSynchronizeResults = handlePullRequest({
    action: "synchronize",
    pull_request: {
      number: 42,
      html_url: "https://github.com/webrenew/credit-renew/pull/42",
      title: "Draft fix",
      draft: true,
    },
  });

  const readyResults = handlePullRequest({
    action: "ready_for_review",
    pull_request: {
      number: 42,
      html_url: "https://github.com/webrenew/credit-renew/pull/42",
      title: "Finish draft",
    },
  });

  const reopenedResults = handlePullRequest({
    action: "reopened",
    pull_request: {
      number: 42,
      html_url: "https://github.com/webrenew/credit-renew/pull/42",
      title: "Reopen fix",
    },
  });

  assert.deepEqual(draftOpenedResults, []);
  assert.deepEqual(draftSynchronizeResults, []);

  assert.deepEqual(readyResults, [
    {
      assignmentType: "pr_review",
      triggerEvent: "pr_opened",
      metadata: {
        pr_number: 42,
        pr_url: "https://github.com/webrenew/credit-renew/pull/42",
        pr_title: "Finish draft",
        pr_author: null,
        head_ref: null,
        head_sha: null,
        head_repo_full_name: null,
        base_ref: null,
        base_sha: null,
        base_repo_full_name: null,
      },
      authorLogin: null,
      authorIsBot: false,
    },
  ]);

  assert.deepEqual(reopenedResults, [
    {
      assignmentType: "pr_review",
      triggerEvent: "pr_opened",
      metadata: {
        pr_number: 42,
        pr_url: "https://github.com/webrenew/credit-renew/pull/42",
        pr_title: "Reopen fix",
        pr_author: null,
        head_ref: null,
        head_sha: null,
        head_repo_full_name: null,
        base_ref: null,
        base_sha: null,
        base_repo_full_name: null,
      },
      authorLogin: null,
      authorIsBot: false,
    },
  ]);
});

test("handlePullRequest surfaces dependabot as the PR author", async () => {
  const { handlePullRequest } = await loadGithubWebhookRoute();

  const results = handlePullRequest({
    action: "opened",
    pull_request: {
      number: 7,
      html_url: "https://github.com/webrenew/vmotif/pull/7",
      title: "chore(deps): bump next from 15.3.1 to 15.3.2",
      user: { login: "dependabot[bot]", type: "Bot" },
    },
  });

  assert.equal(results.length, 1);
  assert.equal(results[0]?.authorLogin, "dependabot[bot]");
  assert.equal(results[0]?.authorIsBot, true);
  assert.equal(results[0]?.metadata.pr_author, "dependabot[bot]");
});

test("handlePullRequest skips bot-authored synchronize events to avoid fix loops", async () => {
  const { handlePullRequest } = await loadGithubWebhookRoute();

  const results = handlePullRequest({
    action: "synchronize",
    sender: {
      login: "mogplex[bot]",
      type: "Bot",
    },
    pull_request: {
      number: 42,
      html_url: "https://github.com/webrenew/credit-renew/pull/42",
    },
  });

  assert.deepEqual(results, []);
});

test("handlePullRequest emits a labeled trigger result with PR and label metadata", async () => {
  const { handlePullRequest } = await loadGithubWebhookRoute();

  const results = handlePullRequest({
    action: "labeled",
    label: { name: "ready-for-review" },
    sender: { login: "octocat", type: "User" },
    pull_request: {
      number: 42,
      html_url: "https://github.com/acme/widgets/pull/42",
      title: "Add widgets",
      draft: true,
      user: { login: "octocat", type: "User" },
      head: {
        ref: "feature",
        sha: "headsha",
        repo: { full_name: "acme/widgets" },
      },
      base: {
        ref: "main",
        sha: "basesha",
        repo: { full_name: "acme/widgets" },
      },
    },
  });

  assert.equal(results.length, 1);
  const result = results[0];
  assert.equal(result?.assignmentType, "labeled");
  assert.equal(result?.triggerEvent, "labeled");
  assert.equal(result?.metadata.label_name, "ready-for-review");
  assert.equal(result?.metadata.sender_login, "octocat");
  assert.equal(result?.metadata.pr_number, 42);
  assert.equal(result?.metadata.issue_number, 42);
  assert.equal(result?.metadata.is_pr, true);
  assert.equal(result?.metadata.head_ref, "feature");
});
