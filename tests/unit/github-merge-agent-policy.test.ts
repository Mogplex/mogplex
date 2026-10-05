import assert from "node:assert/strict";
import test from "node:test";
import type { ToolSet } from "ai";
import {
  mergePullRequestIfSafe,
  queuePullRequestForMerge,
} from "@/lib/github-merge";
import { buildPRReviewTools } from "@/lib/agents/pr-reviewer";
import { attemptFlowAutoMerge } from "@/lib/workflows/automation-job-auto-merge";
import type { MergePolicyDeps } from "@/lib/github-merge-policy";
import type { RecordTeamAuditEventInput } from "@/lib/team-audit";

const head = "a".repeat(40);
const DEFAULT_INPUT = {};
function fixture(
  input: {
    approved?: boolean;
    waiting?: boolean;
    failRead?: boolean;
  } = DEFAULT_INPUT
) {
  const writes: string[] = [];
  const events: RecordTeamAuditEventInput[] = [];
  let claims = 0;
  let requests = 0;
  const deps: MergePolicyDeps = {
    read: async () => {
      if (input.failRead) throw new Error("private diagnostic");
      return { requireApproval: true, contextRepoOnly: true };
    },
    claimApproval: async () => {
      claims += 1;
      return input.approved ? "approved" : null;
    },
    requestApproval: async () => {
      requests += 1;
      return "pending";
    },
  };
  const scope = {
    userId: "user-1",
    teamId: "team-1",
    requestId: "run-1",
    contextRepo: { id: "repo-1", owner: "acme", repo: "widgets" },
    deps,
    recordAuditEvent: async (event: RecordTeamAuditEventInput) => {
      events.push(event);
      return { ok: true as const };
    },
  };
  const fetchImpl: typeof fetch = async (url, init) => {
    if (init?.method && init.method !== "GET") writes.push(String(url));
    const body =
      init?.method === "PUT"
        ? { merged: true, sha: "merged" }
        : init?.method === "POST"
          ? {
              data: {
                enablePullRequestAutoMerge: {
                  pullRequest: { autoMergeRequest: { enabledAt: "now" } },
                },
              },
            }
          : {
              state: "open",
              draft: false,
              mergeable: true,
              mergeable_state: input.waiting ? "blocked" : "clean",
              head: { sha: head },
              node_id: "pr-1",
            };
    return Response.json(body);
  };
  const merge = {
    githubToken: "test-token",
    owner: "acme",
    repo: "widgets",
    prNumber: 42,
    expectedHeadSha: head,
    fetchImpl,
    mergePolicyScope: scope,
  };
  return { merge, scope, writes, events, counts: () => ({ claims, requests }) };
}

test("native merge requires a pending exact-head approval before writing to GitHub", async () => {
  const f = fixture();
  const result = await mergePullRequestIfSafe(f.merge);
  assert.equal(result.merged, false);
  assert.match(result.reason, /requires your approval/);
  assert.deepEqual(f.writes, []);
  assert.equal(f.events[0]?.decisionCode, "approval_required");
});

test("native approved merge consumes once and records the approved exact-head attempt", async () => {
  const f = fixture({ approved: true });
  assert.equal((await mergePullRequestIfSafe(f.merge)).merged, true);
  assert.deepEqual(f.counts(), { claims: 1, requests: 0 });
  assert.equal(f.events[0]?.payload?.approval_id, "approved");
});

test("personal native flows retain merging without a team policy or team audit row", async () => {
  const f = fixture();
  const result = await mergePullRequestIfSafe({
    ...f.merge,
    mergePolicyScope: { ...f.scope, teamId: null },
  });
  assert.equal(result.merged, true);
  assert.deepEqual(f.counts(), { claims: 0, requests: 0 });
  assert.deepEqual(f.events, []);
});

test("approval cannot arm auto-merge that would survive a later head push", async () => {
  const f = fixture({ approved: true, waiting: true });
  const result = await mergePullRequestIfSafe(f.merge);
  assert.equal(result.merged, false);
  assert.equal(result.queued, undefined);
  assert.match(result.reason, /direct merge/);
  assert.deepEqual(f.writes, []);
});

test("queue-only call refuses under approval policy without consuming approval", async () => {
  const f = fixture({ approved: true });
  const result = await queuePullRequestForMerge(f.merge);
  assert.equal(result.queued, undefined);
  assert.match(result.reason, /direct merge/);
  assert.deepEqual(f.counts(), { claims: 0, requests: 0 });
  assert.deepEqual(f.writes, []);
});

test("flow review defers an approved attempt until its required review check completes", async () => {
  const f = fixture({ approved: true });
  const deferred: unknown[] = [];
  const scope = {
    ...f.scope,
    deferUntilReviewComplete: (target: unknown) => {
      deferred.push(target);
    },
  };
  const result = await mergePullRequestIfSafe({
    ...f.merge,
    mergePolicyScope: scope,
  });
  assert.equal(result.merged, false);
  assert.deepEqual(f.counts(), { claims: 0, requests: 0 });
  assert.deepEqual(f.writes, []);
  assert.deepEqual(deferred, [
    { prNumber: 42, expectedHeadSha: head, commitTitle: undefined },
  ]);
  assert.match(result.reason, /review check/);
});

test("native merge fails closed on cross-repo context and unavailable storage", async () => {
  for (const f of [fixture({ approved: true }), fixture({ failRead: true })]) {
    // Changing trusted run context must not change the merge's target.
    f.scope.contextRepo.repo = "different";
    assert.equal((await mergePullRequestIfSafe(f.merge)).merged, false);
    assert.deepEqual(f.writes, []);
    assert.equal(f.counts().claims, 0);
  }
});

test("a refused context cannot produce a deferred native merge request", async () => {
  const f = fixture();
  f.scope.contextRepo.repo = "different";
  const deferred: unknown[] = [];
  const result = await mergePullRequestIfSafe({
    ...f.merge,
    mergePolicyScope: {
      ...f.scope,
      deferUntilReviewComplete: (target) => deferred.push(target),
    },
  });
  assert.equal(result.merged, false);
  assert.deepEqual(deferred, []);
  assert.deepEqual(f.writes, []);
});

test("native reviewer lifecycle tool retains clean-report gate and applies team approval", async () => {
  const f = fixture();
  const config = {
    githubToken: "test-token",
    owner: "acme",
    repo: "widgets",
    prNumber: 42,
    expectedHeadSha: head,
    allowPrLifecycle: true,
    fetch: f.merge.fetchImpl,
    mergePolicyScope: f.scope,
  };
  const tools: ToolSet = buildPRReviewTools(config);
  const report = tools.reportReview.execute!;
  await report(
    { hasIssues: false, summary: "No issues found" },
    { toolCallId: "report", messages: [], context: {} }
  );
  const outcome = await tools.mergePullRequest.execute!(
    {},
    { toolCallId: "merge", messages: [], context: {} }
  );
  assert.equal((outcome as { merged: boolean }).merged, false);
  assert.deepEqual(f.writes, []);
  assert.equal(f.events[0]?.decisionCode, "approval_required");
});

test("post-run flow merge applies the same team approval gate", async () => {
  const f = fixture();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = f.merge.fetchImpl;
  try {
    const input = {
      jobRunId: "run-1",
      repoFullName: "acme/widgets",
      githubToken: "test-token",
      prNumber: 42,
      expectedHeadSha: head,
      mergePolicyScope: f.scope,
    };
    const result = await attemptFlowAutoMerge(input);
    assert.equal(result.merged, false);
    assert.deepEqual(f.writes, []);
    assert.equal(f.events[0]?.decisionCode, "approval_required");
  } finally {
    globalThis.fetch = previousFetch;
  }
});
