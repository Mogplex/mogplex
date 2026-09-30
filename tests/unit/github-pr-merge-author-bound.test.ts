import assert from "node:assert/strict";
import test from "node:test";

import {
  auditedTeamMerge,
  mergeAuditEvent,
  mergeFetch,
  type MergeFetchCall,
} from "./helpers/github-pr-merge-fixtures";

const MERGE_CALL = "PUT /repos/acme/widgets/pulls/84/merge";

function requestLines(calls: MergeFetchCall[]) {
  return calls.map((call) => `${call.method} ${call.path}`);
}

test("github_merge_pull_request merges a PR the user authored", async () => {
  const calls: MergeFetchCall[] = [];
  const events = await auditedTeamMerge(
    mergeFetch(calls, { author: { __typename: "User", login: "Charles" } }),
    ["acme"],
    { userGithubLogin: "charles" }
  );

  assert.deepEqual(events, [
    mergeAuditEvent("merged", { basis: "user_author" }),
  ]);
  assert.ok(requestLines(calls).includes(MERGE_CALL));
});

test("github_merge_pull_request refuses someone else's PR when the repo requires no review", async () => {
  const calls: MergeFetchCall[] = [];
  let result: unknown;
  const events = await auditedTeamMerge(
    mergeFetch(calls, { author: { __typename: "User", login: "mallory" } }),
    ["acme"],
    { userGithubLogin: "charles", onResult: (value) => (result = value) }
  );

  assert.deepEqual(events, [
    mergeAuditEvent("needs_user_merge", {
      error: "author mallory without a required review",
    }),
  ]);
  assert.equal(requestLines(calls).includes(MERGE_CALL), false);
  const { ok, error } = result as { ok: boolean; error: string };
  assert.equal(ok, false);
  assert.ok(
    error.includes("https://github.com/acme/widgets/pull/84"),
    "the refusal should send the user to GitHub"
  );
});

test("github_merge_pull_request refuses another bot's PR when the repo requires no review", async () => {
  const calls: MergeFetchCall[] = [];
  const events = await auditedTeamMerge(
    mergeFetch(calls, { author: { __typename: "Bot", login: "dependabot" } }),
    ["acme"],
    { userGithubLogin: "charles" }
  );

  assert.equal(events[0]?.decisionCode, "needs_user_merge");
  assert.equal(requestLines(calls).includes(MERGE_CALL), false);
});

test("github_merge_pull_request leaves someone else's PR to a required human review", async () => {
  const events = await auditedTeamMerge(
    mergeFetch([], {
      author: { __typename: "User", login: "mallory" },
      reviewDecision: "REVIEW_REQUIRED",
      mergeableState: "blocked",
    }),
    ["acme"],
    { userGithubLogin: "charles" }
  );

  assert.deepEqual(events, [
    mergeAuditEvent("auto_merge_queued", { basis: "human_review" }),
  ]);
});

test("github_merge_pull_request does not merge when it cannot tell who opened the PR", async () => {
  const calls: MergeFetchCall[] = [];
  const events = await auditedTeamMerge(
    mergeFetch(calls, { ownershipStatus: 502 }),
    ["acme"]
  );

  assert.equal(events[0]?.decisionCode, "not_merged");
  assert.equal(requestLines(calls).includes(MERGE_CALL), false);
});
