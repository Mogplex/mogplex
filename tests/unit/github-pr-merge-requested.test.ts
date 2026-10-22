import assert from "node:assert/strict";
import test from "node:test";
import {
  auditedTeamMerge,
  mergeAuditEvent,
  mergeFetch,
  REVIEWED_HEAD_SHA,
  type MergeFetchCall,
} from "@/tests/unit/helpers/github-pr-merge-fixtures";

const mergePath = "/repos/acme/widgets/pulls/84/merge";

test("a user-requested merge accepts human and bot authors without a review requirement", async () => {
  for (const author of [
    { __typename: "User" as const, login: "teammate" },
    { __typename: "Bot" as const, login: "dependabot" },
  ]) {
    const calls: MergeFetchCall[] = [];
    const events = await auditedTeamMerge(mergeFetch(calls, { author }));
    assert.deepEqual(events, [mergeAuditEvent("merged")]);
    assert.deepEqual(calls.at(-1), {
      method: "PUT",
      path: mergePath,
      body: { merge_method: "squash", sha: REVIEWED_HEAD_SHA },
    });
    assert.equal(
      calls.some((call) => call.path === "/graphql"),
      false
    );
    assert.equal(
      calls.some((call) => call.path.includes("/rules/")),
      false
    );
  }
});

test("unavailable author metadata does not block the user's requested merge", async () => {
  const calls: MergeFetchCall[] = [];
  const events = await auditedTeamMerge(
    mergeFetch(calls, { ownershipStatus: 502 })
  );
  assert.deepEqual(events, [mergeAuditEvent("merged")]);
  assert.equal(
    calls.some((call) => call.path === "/graphql"),
    false
  );
});

test("a requested third-party merge still waits on GitHub's required checks and reviews", async () => {
  const calls: MergeFetchCall[] = [];
  const events = await auditedTeamMerge(
    mergeFetch(calls, {
      author: { __typename: "User", login: "teammate" },
      reviewDecision: "REVIEW_REQUIRED",
      mergeableState: "blocked",
    })
  );
  assert.deepEqual(events, [mergeAuditEvent("auto_merge_queued")]);
  assert.equal(
    calls.some((call) => call.path === mergePath),
    false
  );
  const graphql = calls.filter((call) => call.path === "/graphql");
  assert.equal(graphql.length, 1);
  assert.match(JSON.stringify(graphql[0].body), /EnablePullRequestAutoMerge/);
});

test("a requested third-party merge still refuses an unavailable GitHub connection", async () => {
  const calls: MergeFetchCall[] = [];
  const events = await auditedTeamMerge(
    mergeFetch(calls, { author: { __typename: "User", login: "teammate" } }),
    []
  );
  assert.deepEqual(events, [mergeAuditEvent("no_installation")]);
  assert.deepEqual(calls, []);
});
