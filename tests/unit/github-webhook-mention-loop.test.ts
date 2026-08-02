import assert from "node:assert/strict";
import test from "node:test";

import {
  MOGPLEX_AUTOMATION_COMMENT_MARKER,
  withAutomationMarker,
} from "../../lib/github-automation-marker";

async function loadGithubWebhookRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/webhooks/github/route");
}

function commentUser(login: string, type: string, body: string) {
  return {
    id: 1,
    body,
    html_url: "https://github.com/webrenew/supasync/pull/13#issuecomment-1",
    user: { login, type },
  };
}

function issueCommentBody(comment: {
  login: string;
  type: string;
  body: string;
}) {
  return {
    action: "created",
    comment: commentUser(comment.login, comment.type, comment.body),
    issue: {
      number: 13,
      html_url: "https://github.com/webrenew/supasync/pull/13",
      title: "fix(deps): resolve npm audit",
      pull_request: {},
    },
  } as Record<string, unknown>;
}

function prReviewCommentBody(comment: {
  login: string;
  type: string;
  body: string;
}) {
  return {
    action: "created",
    comment: commentUser(comment.login, comment.type, comment.body),
    pull_request: {
      number: 13,
      html_url: "https://github.com/webrenew/supasync/pull/13",
      title: "fix(deps): resolve npm audit",
    },
  } as Record<string, unknown>;
}

function commitCommentBody(comment: {
  login: string;
  type: string;
  body: string;
}) {
  return {
    action: "created",
    comment: {
      ...commentUser(comment.login, comment.type, comment.body),
      commit_id: "925bfd2",
    },
  } as Record<string, unknown>;
}

const HUMAN_MENTION = "@mogplex please fix the failing tests";
const SELF_REPLY = "Thanks @mogplex — addressed all three.";

// --- handleIssueComment ---

test("handleIssueComment triggers a mention for a human @mogplex comment", async () => {
  const { handleIssueComment } = await loadGithubWebhookRoute();
  const results = handleIssueComment(
    issueCommentBody({
      login: "charlesrhoward",
      type: "User",
      body: HUMAN_MENTION,
    })
  );
  assert.equal(results.length, 1);
  assert.equal(results[0].triggerEvent, "mention");
});

test("handleIssueComment skips our own marked comment even when posted as a User", async () => {
  const { handleIssueComment } = await loadGithubWebhookRoute();
  const results = handleIssueComment(
    issueCommentBody({
      login: "charlesrhoward",
      type: "User",
      body: withAutomationMarker(SELF_REPLY),
    })
  );
  assert.deepEqual(results, []);
});

test("handleIssueComment still skips App bot comments", async () => {
  const { handleIssueComment } = await loadGithubWebhookRoute();
  const results = handleIssueComment(
    issueCommentBody({
      login: "mogplex[bot]",
      type: "Bot",
      body: `@mogplex follow-up ${MOGPLEX_AUTOMATION_COMMENT_MARKER}`,
    })
  );
  assert.deepEqual(results, []);
});

// --- handlePRReviewComment ---

test("handlePRReviewComment triggers a mention for a human @mogplex comment", async () => {
  const { handlePRReviewComment } = await loadGithubWebhookRoute();
  const results = handlePRReviewComment(
    prReviewCommentBody({
      login: "charlesrhoward",
      type: "User",
      body: HUMAN_MENTION,
    })
  );
  assert.equal(results.length, 1);
  assert.equal(results[0].triggerEvent, "mention");
});

test("handlePRReviewComment skips our own marked comment posted as a User", async () => {
  const { handlePRReviewComment } = await loadGithubWebhookRoute();
  const results = handlePRReviewComment(
    prReviewCommentBody({
      login: "charlesrhoward",
      type: "User",
      body: withAutomationMarker(SELF_REPLY),
    })
  );
  assert.deepEqual(results, []);
});

// --- handleCommitComment (the closed loop vector) ---

test("handleCommitComment triggers a mention for a human @mogplex comment", async () => {
  const { handleCommitComment } = await loadGithubWebhookRoute();
  const results = handleCommitComment(
    commitCommentBody({
      login: "charlesrhoward",
      type: "User",
      body: HUMAN_MENTION,
    })
  );
  assert.equal(results.length, 1);
  assert.equal(results[0].triggerEvent, "mention");
});

test("handleCommitComment skips our own marked commit comment posted as a User", async () => {
  const { handleCommitComment } = await loadGithubWebhookRoute();
  const results = handleCommitComment(
    commitCommentBody({
      login: "charlesrhoward",
      type: "User",
      body: withAutomationMarker("Pushed fix in this commit. @mogplex"),
    })
  );
  assert.deepEqual(results, []);
});

// --- loop-breaker backstop ---

function mentionJob(
  overrides: Partial<{
    sourceType: string;
    repoId: string | null;
    metadata: Record<string, unknown>;
  }> = {}
) {
  return {
    userId: "user-1",
    status: "pending" as const,
    metadata: overrides.metadata ?? { issue_number: 13 },
    idempotency_key: "key-1",
    flow_id: "flow-1",
    flow_version_id: "version-1",
    scope: {
      sourceKind: "flow" as const,
      sourceType: overrides.sourceType ?? "mention",
      sourceId: "flow-1",
      repoId: overrides.repoId === undefined ? "repo-1" : overrides.repoId,
      installationId: 123,
    },
  };
}

test("evaluateMentionLoopBreaker trips at or above the threshold", async () => {
  const { evaluateMentionLoopBreaker } = await loadGithubWebhookRoute();
  const tripped = await evaluateMentionLoopBreaker(
    [mentionJob()],
    async () => 3
  );
  assert.deepEqual(tripped, [true]);
});

test("evaluateMentionLoopBreaker allows runs below the threshold", async () => {
  const { evaluateMentionLoopBreaker } = await loadGithubWebhookRoute();
  const tripped = await evaluateMentionLoopBreaker(
    [mentionJob()],
    async () => 2
  );
  assert.deepEqual(tripped, [false]);
});

test("evaluateMentionLoopBreaker ignores non-mention jobs", async () => {
  const { evaluateMentionLoopBreaker } = await loadGithubWebhookRoute();
  let called = false;
  const tripped = await evaluateMentionLoopBreaker(
    [mentionJob({ sourceType: "pr_review" })],
    async () => {
      called = true;
      return 99;
    }
  );
  assert.deepEqual(tripped, [false]);
  assert.equal(called, false, "must not query the DB for non-mention jobs");
});

test("evaluateMentionLoopBreaker fails open when counting throws", async () => {
  const { evaluateMentionLoopBreaker } = await loadGithubWebhookRoute();
  const tripped = await evaluateMentionLoopBreaker([mentionJob()], async () => {
    throw new Error("supabase down");
  });
  assert.deepEqual(
    tripped,
    [false],
    "a counting error must not block legitimate mentions"
  );
});

test("evaluateMentionLoopBreaker skips when issue_number is absent", async () => {
  const { evaluateMentionLoopBreaker } = await loadGithubWebhookRoute();
  const tripped = await evaluateMentionLoopBreaker(
    [mentionJob({ metadata: {} })],
    async () => 99
  );
  assert.deepEqual(tripped, [false]);
});

test("evaluateMentionLoopBreaker counts in-batch siblings toward the cap", async () => {
  const { evaluateMentionLoopBreaker } = await loadGithubWebhookRoute();
  // DB shows 1 prior delivery; with three same-issue jobs in this batch the
  // third reaches the cap of 3 (1 + 2 siblings) and is suppressed, while the
  // first two are allowed.
  const tripped = await evaluateMentionLoopBreaker(
    [mentionJob(), mentionJob(), mentionJob()],
    async () => 1
  );
  assert.deepEqual(tripped, [false, false, true]);
});

test("evaluateMentionLoopBreaker snapshots the count once per key (no double-count)", async () => {
  const { evaluateMentionLoopBreaker } = await loadGithubWebhookRoute();
  // The reviewer's race: with no prior rows, a 3-job same-issue batch must
  // allow all three (the cap is 3). The count is taken once up front, before
  // any sibling enqueues, so a sibling's own queued row can never inflate it.
  let calls = 0;
  const tripped = await evaluateMentionLoopBreaker(
    [mentionJob(), mentionJob(), mentionJob()],
    async () => {
      calls += 1;
      return 0;
    }
  );
  assert.deepEqual(tripped, [false, false, false]);
  assert.equal(calls, 1, "must snapshot the count exactly once per loop key");
});

test("evaluateMentionLoopBreaker counts each repo+issue independently", async () => {
  const { evaluateMentionLoopBreaker } = await loadGithubWebhookRoute();
  let calls = 0;
  const tripped = await evaluateMentionLoopBreaker(
    [
      mentionJob(),
      mentionJob({ metadata: { issue_number: 99 } }),
      mentionJob(),
      mentionJob(),
    ],
    async () => {
      calls += 1;
      return 2;
    }
  );
  // #13 occurs at indices 0,2,3 → siblings 0,1,2 over a snapshot of 2: the
  // second (2+1) and third (2+2) trip; #99 (index 1) is its own key, sibling
  // 0, so 2+0 < 3 stays allowed.
  assert.deepEqual(tripped, [false, false, true, true]);
  assert.equal(calls, 2, "one snapshot per distinct repo+issue");
});

// --- in-batch sibling counting ---

test("countInBatchMentionSiblings numbers siblings per repo+issue", async () => {
  const { countInBatchMentionSiblings } = await loadGithubWebhookRoute();
  const counts = countInBatchMentionSiblings([
    mentionJob(),
    mentionJob(),
    mentionJob({ metadata: { issue_number: 99 } }),
    mentionJob(),
  ]);
  // #13 occurrences (indices 0,1,3) number 0,1,2; the lone #99 restarts at 0.
  assert.deepEqual(counts, [0, 1, 0, 2]);
});

test("countInBatchMentionSiblings ignores non-mention and unkeyed jobs", async () => {
  const { countInBatchMentionSiblings } = await loadGithubWebhookRoute();
  const counts = countInBatchMentionSiblings([
    mentionJob({ sourceType: "pr_review" }),
    mentionJob({ repoId: null }),
    mentionJob({ metadata: {} }),
    mentionJob(),
    mentionJob(),
  ]);
  assert.deepEqual(counts, [0, 0, 0, 0, 1]);
});
