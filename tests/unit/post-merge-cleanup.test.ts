import assert from "node:assert/strict";
import test from "node:test";
import {
  auditRemoteBranches,
  buildPostMergeCleanupPlan,
  parsePostMergeCleanupArgs,
} from "@/lib/git/post-merge-cleanup";

test("parsePostMergeCleanupArgs reads branch and dry-run flags", () => {
  assert.deepEqual(
    parsePostMergeCleanupArgs(["--branch", "feat/example", "--dry-run"]),
    {
      branch: "feat/example",
      dryRun: true,
      remotes: false,
    }
  );
});

test("parsePostMergeCleanupArgs reads the remotes flag", () => {
  assert.deepEqual(parsePostMergeCleanupArgs(["--remotes"]), {
    branch: null,
    dryRun: false,
    remotes: true,
  });
});

const mergedPullRequest = {
  url: "https://github.com/webrenew/mogplex/pull/999",
  state: "MERGED",
  mergedAt: "2026-07-01T20:00:00Z",
  baseRefName: "main",
  headRefName: "fix/example",
  headRefOid: "abc123",
};

test("auditRemoteBranches flags commits pushed after the PR merged as orphaned", () => {
  const audit = auditRemoteBranches({
    defaultBranch: "main",
    remoteBranches: [
      {
        name: "fix/example",
        headOid: "def456",
        isAncestorOfDefault: false,
        pullRequest: mergedPullRequest,
      },
    ],
  });

  assert.equal(audit.landed.length, 0);
  assert.equal(audit.unresolved.length, 0);
  assert.deepEqual(audit.orphaned, [
    {
      name: "fix/example",
      pullRequestUrl: "https://github.com/webrenew/mogplex/pull/999",
      headOid: "def456",
      mergedHeadOid: "abc123",
    },
  ]);
});

test("auditRemoteBranches treats a tip matching the merged PR head as landed", () => {
  const audit = auditRemoteBranches({
    defaultBranch: "main",
    remoteBranches: [
      {
        name: "fix/example",
        headOid: "abc123",
        isAncestorOfDefault: false,
        pullRequest: mergedPullRequest,
      },
    ],
  });

  assert.equal(audit.orphaned.length, 0);
  assert.equal(audit.landed.length, 1);
  assert.equal(audit.landed[0].name, "fix/example");
});

test("auditRemoteBranches trusts ancestry over pull request metadata", () => {
  const audit = auditRemoteBranches({
    defaultBranch: "main",
    remoteBranches: [
      {
        name: "chore/no-pr",
        headOid: "aaa111",
        isAncestorOfDefault: true,
        pullRequest: null,
      },
    ],
  });

  assert.equal(audit.orphaned.length, 0);
  assert.equal(audit.unresolved.length, 0);
  assert.deepEqual(audit.landed, [
    { name: "chore/no-pr", reason: "already contained in main" },
  ]);
});

test("auditRemoteBranches leaves branches without a merged PR unresolved", () => {
  const audit = auditRemoteBranches({
    defaultBranch: "main",
    remoteBranches: [
      {
        name: "feat/no-pr",
        headOid: "bbb222",
        isAncestorOfDefault: false,
        pullRequest: null,
      },
      {
        name: "feat/open-pr",
        headOid: "ccc333",
        isAncestorOfDefault: false,
        pullRequest: { ...mergedPullRequest, state: "OPEN", mergedAt: null },
      },
    ],
  });

  assert.equal(audit.landed.length, 0);
  assert.equal(audit.orphaned.length, 0);
  assert.deepEqual(
    audit.unresolved.map((branch) => branch.name),
    ["feat/no-pr", "feat/open-pr"]
  );
});

test("auditRemoteBranches never classifies the default branch", () => {
  const audit = auditRemoteBranches({
    defaultBranch: "main",
    remoteBranches: [
      {
        name: "main",
        headOid: "ddd444",
        isAncestorOfDefault: false,
        pullRequest: null,
      },
    ],
  });

  assert.deepEqual(audit, { landed: [], orphaned: [], unresolved: [] });
});

test("buildPostMergeCleanupPlan returns a force-delete plan for squash-merged branches", () => {
  const plan = buildPostMergeCleanupPlan({
    currentBranch: "feat/example",
    defaultBranch: "main",
    targetBranch: "feat/example",
    localHeadOid: "abc123",
    workingTreeDirty: false,
    pullRequest: {
      url: "https://github.com/webrenew/mogplex/pull/999",
      state: "MERGED",
      mergedAt: "2026-04-06T20:00:00Z",
      baseRefName: "main",
      headRefName: "feat/example",
      headRefOid: "abc123",
    },
  });

  assert.deepEqual(plan, {
    currentBranch: "feat/example",
    defaultBranch: "main",
    targetBranch: "feat/example",
    pullRequestUrl: "https://github.com/webrenew/mogplex/pull/999",
    shouldCheckoutDefaultBranch: true,
    shouldPullDefaultBranch: true,
    shouldDeleteBranch: true,
    deleteBranchForce: true,
    branchesToPrune: [],
  });
});

test("buildPostMergeCleanupPlan syncs the default branch without deleting it", () => {
  const plan = buildPostMergeCleanupPlan({
    currentBranch: "main",
    defaultBranch: "main",
    targetBranch: "main",
    localHeadOid: "abc123",
    workingTreeDirty: false,
    pullRequest: null,
  });

  assert.deepEqual(plan, {
    currentBranch: "main",
    defaultBranch: "main",
    targetBranch: "main",
    pullRequestUrl: null,
    shouldCheckoutDefaultBranch: false,
    shouldPullDefaultBranch: true,
    shouldDeleteBranch: false,
    deleteBranchForce: false,
    branchesToPrune: [],
  });
});

test("buildPostMergeCleanupPlan prunes other merged local branches whose PR head still matches", () => {
  const plan = buildPostMergeCleanupPlan({
    currentBranch: "main",
    defaultBranch: "main",
    targetBranch: "main",
    localHeadOid: "abc123",
    workingTreeDirty: false,
    pullRequest: null,
    localBranches: [
      {
        name: "feat/eligible",
        headOid: "eligible123",
        pullRequest: {
          url: "https://github.com/webrenew/mogplex/pull/1001",
          state: "MERGED",
          mergedAt: "2026-04-06T20:00:00Z",
          baseRefName: "main",
          headRefName: "feat/eligible",
          headRefOid: "eligible123",
        },
      },
      {
        name: "feat/open",
        headOid: "open123",
        pullRequest: {
          url: "https://github.com/webrenew/mogplex/pull/1002",
          state: "OPEN",
          mergedAt: null,
          baseRefName: "main",
          headRefName: "feat/open",
          headRefOid: "open123",
        },
      },
      {
        name: "feat/drifted",
        headOid: "local456",
        pullRequest: {
          url: "https://github.com/webrenew/mogplex/pull/1003",
          state: "MERGED",
          mergedAt: "2026-04-06T20:00:00Z",
          baseRefName: "main",
          headRefName: "feat/drifted",
          headRefOid: "remote789",
        },
      },
      {
        name: "main",
        headOid: "abc123",
        pullRequest: null,
      },
    ],
  });

  assert.deepEqual(plan.branchesToPrune, [
    {
      name: "feat/eligible",
      pullRequestUrl: "https://github.com/webrenew/mogplex/pull/1001",
      deleteBranchForce: true,
    },
  ]);
});

test("buildPostMergeCleanupPlan rejects dirty working trees", () => {
  assert.throws(
    () =>
      buildPostMergeCleanupPlan({
        currentBranch: "feat/example",
        defaultBranch: "main",
        targetBranch: "feat/example",
        localHeadOid: "abc123",
        workingTreeDirty: true,
        pullRequest: {
          url: "https://github.com/webrenew/mogplex/pull/999",
          state: "MERGED",
          mergedAt: "2026-04-06T20:00:00Z",
          baseRefName: "main",
          headRefName: "feat/example",
          headRefOid: "abc123",
        },
      }),
    /requires a clean working tree/
  );
});

test("buildPostMergeCleanupPlan does not auto-prune the non-target branch the user is currently on", () => {
  const plan = buildPostMergeCleanupPlan({
    currentBranch: "feat/current",
    defaultBranch: "main",
    targetBranch: "main",
    localHeadOid: "abc123",
    workingTreeDirty: false,
    pullRequest: null,
    localBranches: [
      {
        name: "feat/current",
        headOid: "current123",
        pullRequest: {
          url: "https://github.com/webrenew/mogplex/pull/1004",
          state: "MERGED",
          mergedAt: "2026-04-06T20:00:00Z",
          baseRefName: "main",
          headRefName: "feat/current",
          headRefOid: "current123",
        },
      },
    ],
  });

  assert.deepEqual(plan.branchesToPrune, []);
});

test("buildPostMergeCleanupPlan rejects branches that drifted after the merged PR head", () => {
  assert.throws(
    () =>
      buildPostMergeCleanupPlan({
        currentBranch: "feat/example",
        defaultBranch: "main",
        targetBranch: "feat/example",
        localHeadOid: "def456",
        workingTreeDirty: false,
        pullRequest: {
          url: "https://github.com/webrenew/mogplex/pull/999",
          state: "MERGED",
          mergedAt: "2026-04-06T20:00:00Z",
          baseRefName: "main",
          headRefName: "feat/example",
          headRefOid: "abc123",
        },
      }),
    /Refusing to delete potentially unpublished work/
  );
});
