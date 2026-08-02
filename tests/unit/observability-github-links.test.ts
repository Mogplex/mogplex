import assert from "node:assert/strict";
import test from "node:test";
import { resolveGithubObservabilityLink } from "../../lib/observability/github-links";

test("resolveGithubObservabilityLink prefers direct PR comment URLs", () => {
  const link = resolveGithubObservabilityLink({
    sourceType: "pr_comment",
    repoFullName: "acme/widgets",
    metadata: {
      comment_url:
        "https://github.com/acme/widgets/pull/42?ignored=yes#issuecomment-501",
      issue_number: 42,
      is_pr: true,
    },
  });

  assert.deepEqual(link, {
    href: "https://github.com/acme/widgets/pull/42#issuecomment-501",
    label: "PR comment on #42",
    kind: "pr_comment",
  });
});

test("resolveGithubObservabilityLink falls back to pull requests from repo metadata", () => {
  const link = resolveGithubObservabilityLink({
    sourceType: "pr_review",
    repoFullName: "acme/widgets",
    metadata: {
      pr_number: "13",
    },
  });

  assert.deepEqual(link, {
    href: "https://github.com/acme/widgets/pull/13",
    label: "PR #13",
    kind: "pr",
  });
});

test("resolveGithubObservabilityLink resolves workflow and check run links", () => {
  const workflowLink = resolveGithubObservabilityLink({
    sourceType: "ci_failure",
    metadata: {
      html_url: "https://github.com/acme/widgets/actions/runs/123456789",
      run_id: 123456789,
    },
  });
  const checkRunLink = resolveGithubObservabilityLink({
    sourceType: "ci_failure",
    metadata: {
      details_url: "https://github.com/acme/widgets/runs/99",
    },
  });

  assert.deepEqual(workflowLink, {
    href: "https://github.com/acme/widgets/actions/runs/123456789",
    label: "Workflow run #123456789",
    kind: "run",
  });
  assert.deepEqual(checkRunLink, {
    href: "https://github.com/acme/widgets/runs/99",
    label: "Check run",
    kind: "check",
  });
});

test("resolveGithubObservabilityLink falls back to commit links for commit events", () => {
  const link = resolveGithubObservabilityLink({
    sourceType: "mention",
    repoFullName: "acme/widgets",
    metadata: {
      commit_id: "1234567890abcdef",
    },
  });

  assert.deepEqual(link, {
    href: "https://github.com/acme/widgets/commit/1234567890abcdef",
    label: "Commit 1234567",
    kind: "commit",
  });
});

test("resolveGithubObservabilityLink rejects non-GitHub URLs without a safe fallback", () => {
  const link = resolveGithubObservabilityLink({
    sourceType: "issue_comment",
    metadata: {
      comment_url: "https://example.com/not-github",
      repo_full_name: "not a repo",
    },
  });

  assert.equal(link, null);
});
