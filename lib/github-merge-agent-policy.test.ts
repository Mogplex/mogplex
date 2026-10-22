import assert from "node:assert/strict";
import { test } from "vitest";
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
    waiting?: boolean;
    failRead?: boolean;
  } = DEFAULT_INPUT
) {
  const writes: string[] = [];
  const events: RecordTeamAuditEventInput[] = [];
  const deps: MergePolicyDeps = {
    read: async () => {
      if (input.failRead) throw new Error("private diagnostic");
      return { requireApproval: true, contextRepoOnly: true };
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
  return { merge, scope, writes, events };
}

test("native requested merges ignore retired approval settings", async () => {
  const f = fixture();
  const result = await mergePullRequestIfSafe(f.merge);
  assert.equal(result.merged, true);
  assert.equal(f.events[0]?.decisionCode, "merged");
});

test("native merge records the exact-head attempt without consuming old approvals", async () => {
  const f = fixture();
  assert.equal((await mergePullRequestIfSafe(f.merge)).merged, true);
  assert.equal(f.events[0]?.payload?.approval_id, undefined);
});

test("personal native flows retain merging without a team policy or team audit row", async () => {
  const f = fixture();
  const result = await mergePullRequestIfSafe({
    ...f.merge,
    mergePolicyScope: { ...f.scope, teamId: null },
  });
  assert.equal(result.merged, true);
  assert.deepEqual(f.events, []);
});

test("pending GitHub checks can queue the requested merge despite old approval settings", async () => {
  const f = fixture({ waiting: true });
  const result = await mergePullRequestIfSafe(f.merge);
  assert.equal(result.merged, false);
  assert.equal(result.queued, true);
  assert.deepEqual(f.writes, ["https://api.github.com/graphql"]);
});

test("queue-only calls ignore old approval settings without consuming approval", async () => {
  const f = fixture();
  const result = await queuePullRequestForMerge(f.merge);
  assert.equal(result.queued, true);
  assert.deepEqual(f.writes, ["https://api.github.com/graphql"]);
});

test("default-off team controls retain native GitHub auto-merge without an approval claim", async () => {
  const f = fixture();
  f.scope.deps.read = async () => ({
    requireApproval: false,
    contextRepoOnly: false,
  });
  const result = await queuePullRequestForMerge(f.merge);
  assert.equal(result.merged, false);
  assert.equal(result.queued, true);
  assert.deepEqual(f.writes, ["https://api.github.com/graphql"]);
  assert.equal(f.events[0]?.decisionCode, "auto_merge_queued");
});

test("flow review defers a requested attempt until its required review check completes", async () => {
  const f = fixture();
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
  assert.deepEqual(f.writes, []);
  assert.deepEqual(deferred, [
    { prNumber: 42, expectedHeadSha: head, commitTitle: undefined },
  ]);
  assert.match(result.reason, /review check/);
});

test("native cross-repository merges work but live team permission remains required", async () => {
  for (const failRead of [false, true]) {
    const f = fixture({ failRead });
    // Changing trusted run context must not change the merge's target.
    f.scope.contextRepo.repo = "different";
    assert.equal((await mergePullRequestIfSafe(f.merge)).merged, !failRead);
    assert.equal(f.writes.length, failRead ? 0 : 1);
  }
});

test("cross-repository context can still defer until the flow publishes its review", async () => {
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
  assert.deepEqual(deferred, [
    { prNumber: 42, expectedHeadSha: head, commitTitle: undefined },
  ]);
  assert.deepEqual(f.writes, []);
});

test("native reviewer lifecycle tool merges after its clean report without extra approval", async () => {
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
  assert.equal((outcome as { merged: boolean }).merged, true);
  assert.equal(f.writes.length, 1);
  assert.equal(f.events[0]?.decisionCode, "merged");
});

test("post-run requested flow merge needs no second human approval", async () => {
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
    assert.equal(result.merged, true);
    assert.equal(f.writes.length, 1);
    assert.equal(f.events[0]?.decisionCode, "merged");
  } finally {
    globalThis.fetch = previousFetch;
  }
});
