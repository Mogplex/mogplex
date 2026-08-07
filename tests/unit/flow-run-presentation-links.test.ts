import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveReviewedTargetLink,
  resolveReviewFindingIssueLink,
} from "../../lib/flows/run-presentation";
import {
  buildReviewedTargetRun,
  type ReviewedTargetRunFixture,
} from "./helpers/flow-run-presentation-fixtures";

test("reviewed target resolves GitHub pull request links from repo and metadata", () => {
  assert.deepEqual(resolveReviewedTargetLink(buildReviewedTargetRun()), {
    href: "https://github.com/webrenew/mogplex/pull/138",
    label: "PR #138",
  });
});

test("reviewed target prefers a canonical PR URL when repository metadata is missing", () => {
  assert.deepEqual(
    resolveReviewedTargetLink(
      buildReviewedTargetRun({
        repo: { id: null, full_name: null },
        metadata: {
          pr_number: 138,
          pr_url:
            "https://github.com/webrenew/mogplex/pull/138?utm_source=run#discussion",
        },
      })
    ),
    {
      href: "https://github.com/webrenew/mogplex/pull/138",
      label: "PR #138",
    }
  );
});

test("reviewed target rejects unsafe PR URLs and keeps the legacy fallback", () => {
  const invalidPrUrls: Array<{ name: string; value: unknown }> = [
    {
      name: "non-GitHub host",
      value: "https://example.com/webrenew/mogplex/pull/999",
    },
    {
      name: "spoofed GitHub subdomain",
      value: "https://github.com.evil.example/webrenew/mogplex/pull/999",
    },
    {
      name: "non-HTTPS protocol",
      // eslint-disable-next-line sonarjs/no-clear-text-protocols -- rejection-path fixture
      value: "http://github.com/webrenew/mogplex/pull/999",
    },
    {
      name: "unsafe protocol",
      // eslint-disable-next-line no-script-url -- rejection-path fixture
      value: "javascript:alert('unsafe')",
    },
    { name: "malformed URL", value: "not a url" },
    {
      name: "issue path instead of pull request path",
      value: "https://github.com/webrenew/mogplex/issues/999",
    },
    {
      name: "non-numeric pull request number",
      value: "https://github.com/webrenew/mogplex/pull/not-a-number",
    },
    {
      name: "zero pull request number",
      value: "https://github.com/webrenew/mogplex/pull/0",
    },
    {
      name: "extra path segment",
      value: "https://github.com/webrenew/mogplex/pull/999/files",
    },
    {
      name: "missing repository segment",
      value: "https://github.com/webrenew/pull/999",
    },
    {
      name: "non-string metadata",
      value: { href: "https://github.com/webrenew/mogplex/pull/999" },
    },
  ];
  const legacyFallback = {
    href: "https://github.com/webrenew/mogplex/pull/138",
    label: "PR #138",
  };

  for (const scenario of invalidPrUrls) {
    assert.deepEqual(
      resolveReviewedTargetLink(
        buildReviewedTargetRun({
          metadata: { pr_number: 138, pr_url: scenario.value },
        })
      ),
      legacyFallback,
      scenario.name
    );
  }

  assert.equal(
    resolveReviewedTargetLink(
      buildReviewedTargetRun({
        repo: { id: null, full_name: null },
        metadata: {
          pr_url: "https://github.com/webrenew/mogplex/issues/138",
        },
      })
    ),
    null
  );
});

test("reviewed target resolves GitHub issue links from issue_number metadata", () => {
  assert.deepEqual(
    resolveReviewedTargetLink(
      buildReviewedTargetRun({
        metadata: { issue_number: 42, issue_url: "ignored" },
      })
    ),
    {
      href: "https://github.com/webrenew/mogplex/issues/42",
      label: "Issue #42",
    }
  );
});

test("reviewed target routes PR comments (is_pr) through the pull request URL", () => {
  assert.deepEqual(
    resolveReviewedTargetLink(
      buildReviewedTargetRun({
        metadata: { issue_number: 99, is_pr: true },
      })
    ),
    {
      href: "https://github.com/webrenew/mogplex/pull/99",
      label: "PR #99",
    }
  );
});

test("reviewed target resolves push commits from head_sha", () => {
  assert.deepEqual(
    resolveReviewedTargetLink(
      buildReviewedTargetRun({
        metadata: { head_sha: "abcdef1234567890abcdef1234567890abcdef12" },
      })
    ),
    {
      href: "https://github.com/webrenew/mogplex/commit/abcdef1234567890abcdef1234567890abcdef12",
      label: "Commit abcdef1",
    }
  );
});

test("reviewed target resolves commit comments from commit_id", () => {
  assert.deepEqual(
    resolveReviewedTargetLink(
      buildReviewedTargetRun({
        metadata: { commit_id: "0123456789abcdef0123456789abcdef01234567" },
      })
    ),
    {
      href: "https://github.com/webrenew/mogplex/commit/0123456789abcdef0123456789abcdef01234567",
      label: "Commit 0123456",
    }
  );
});

test("reviewed target prefers PR over issue when both are present", () => {
  assert.deepEqual(
    resolveReviewedTargetLink(
      buildReviewedTargetRun({
        metadata: { pr_number: 12, issue_number: 99 },
      })
    ),
    {
      href: "https://github.com/webrenew/mogplex/pull/12",
      label: "PR #12",
    }
  );
});

test("reviewed target rejects commit shas that are not hex or are too short", () => {
  for (const badSha of ["nothex0", "abcdef", "abc xyz1234567"]) {
    assert.equal(
      resolveReviewedTargetLink(
        buildReviewedTargetRun({ metadata: { head_sha: badSha } })
      ),
      null,
      `should reject head_sha ${JSON.stringify(badSha)}`
    );
  }
});

test("reviewed target rejects malformed repo names and missing metadata", () => {
  const invalidReviewedTargetRuns: Array<{
    name: string;
    run: ReviewedTargetRunFixture;
  }> = [
    {
      name: "missing metadata",
      run: buildReviewedTargetRun({ metadata: null }),
    },
    {
      name: "missing repo",
      run: buildReviewedTargetRun({ repo: { id: null, full_name: null } }),
    },
    {
      name: "query string in repo full name",
      run: buildReviewedTargetRun({
        repo: { id: "repo-1", full_name: "webrenew/mogplex?tab=readme" },
      }),
    },
    {
      name: "embedded whitespace in repo full name",
      run: buildReviewedTargetRun({
        repo: { id: "repo-1", full_name: "webrenew/\nmogplex" },
      }),
    },
    {
      name: "path traversal in repo full name",
      run: buildReviewedTargetRun({
        repo: { id: "repo-1", full_name: "webrenew/../../../admin" },
        metadata: { pr_number: 1 },
      }),
    },
  ];

  for (const scenario of invalidReviewedTargetRuns) {
    assert.equal(resolveReviewedTargetLink(scenario.run), null, scenario.name);
  }
});

test("review finding issue links are restricted to canonical github issue urls", () => {
  assert.equal(
    resolveReviewFindingIssueLink("https://github.com/acme/widgets/issues/77"),
    "https://github.com/acme/widgets/issues/77"
  );
  assert.equal(
    resolveReviewFindingIssueLink(
      "https://github.com/acme/widgets/issues/77?utm_source=test"
    ),
    "https://github.com/acme/widgets/issues/77"
  );
  assert.equal(
    resolveReviewFindingIssueLink(
      "https://github.com/acme/widgets/issues/not-a-number"
    ),
    null
  );
  assert.equal(
    resolveReviewFindingIssueLink("https://example.com/acme/widgets/issues/77"),
    null
  );
  assert.equal(
    resolveReviewFindingIssueLink("https://github.com/acme/widgets/pull/77"),
    null
  );
});
