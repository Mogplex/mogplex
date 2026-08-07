import assert from "node:assert/strict";
import test from "node:test";
import {
  withFetch,
  loadWaitService,
} from "./helpers/flow-wait-service-fixtures";

test("routeGithubLabeledEventToFlowWaits filters by label and PR scope before resuming", async () => {
  const { routeGithubLabeledEventToFlowWaits } = await loadWaitService();

  const candidates = [
    {
      id: "match-pr",
      user_id: "u",
      job_run_id: "j1",
      flow_id: "f",
      installation_id: 99 as number | null,
      repo_id: null,
      node_id: "n",
      wait_kind: "github_label_added" as const,
      wait_config: {
        kind: "github_label_added" as const,
        labelName: "ready",
        prOnly: true,
      },
      resume_token: "tok-pr",
    },
    {
      id: "skip-different-label",
      user_id: "u",
      job_run_id: "j2",
      flow_id: "f",
      installation_id: 99 as number | null,
      repo_id: null,
      node_id: "n",
      wait_kind: "github_label_added" as const,
      wait_config: {
        kind: "github_label_added" as const,
        labelName: "other",
        prOnly: false,
      },
      resume_token: "tok-other",
    },
    {
      id: "skip-issue-only",
      user_id: "u",
      job_run_id: "j3",
      flow_id: "f",
      installation_id: 99 as number | null,
      repo_id: null,
      node_id: "n",
      wait_kind: "github_label_added" as const,
      wait_config: {
        kind: "github_label_added" as const,
        labelName: "ready",
        prOnly: true,
      },
      resume_token: "tok-issue",
    },
  ];

  const resumeCalls: string[] = [];

  const outcome = await routeGithubLabeledEventToFlowWaits(
    {
      installationId: 99,
      repoId: null,
      repoFullName: null,
      accountType: "User",
      labelName: "ready",
      isPullRequest: false,
      deliveryId: "d-1",
      payload: { action: "labeled" },
    },
    {
      findCandidates: async () => candidates,
      resumeWait: async ({ candidate }) => {
        resumeCalls.push(candidate.id);
        return { resumed: true, resumeToken: candidate.resume_token };
      },
      loadStartFilters: async () => new Map(),
    }
  );

  assert.equal(outcome.matched, 0);
  assert.equal(outcome.resumed, 0);
  assert.equal(resumeCalls.length, 0);

  resumeCalls.length = 0;
  const prOutcome = await routeGithubLabeledEventToFlowWaits(
    {
      installationId: 99,
      repoId: null,
      repoFullName: null,
      accountType: "User",
      labelName: "ready",
      isPullRequest: true,
      deliveryId: "d-2",
      payload: { action: "labeled" },
    },
    {
      findCandidates: async () => candidates,
      resumeWait: async ({ candidate }) => {
        resumeCalls.push(candidate.id);
        return { resumed: true, resumeToken: candidate.resume_token };
      },
      loadStartFilters: async () => new Map(),
    }
  );

  assert.equal(prOutcome.matched, 2);
  assert.equal(prOutcome.resumed, 2);
  assert.deepEqual(
    resumeCalls.sort((a, b) => a.localeCompare(b)),
    ["match-pr", "skip-issue-only"]
  );
});

test("routeGithubLabeledEventToFlowWaits dual-read still resumes a wait whose parent flow filter rejects the delivery", async () => {
  const { routeGithubLabeledEventToFlowWaits } = await loadWaitService();

  const candidates = [
    {
      id: "wait-1",
      user_id: "u",
      job_run_id: "j1",
      flow_id: "flow-org-only",
      installation_id: 99 as number | null,
      repo_id: null,
      node_id: "n",
      wait_kind: "github_label_added" as const,
      wait_config: {
        kind: "github_label_added" as const,
        labelName: "ready",
        prOnly: false,
      },
      resume_token: "tok-1",
    },
  ];

  const resumeCalls: string[] = [];
  const dualReadLogs: Array<Record<string, unknown>> = [];
  const originalLog = console.log;
  console.log = (message: unknown) => {
    if (typeof message !== "string") return;
    try {
      const parsed = JSON.parse(message) as Record<string, unknown>;
      if (parsed.event === "wait_routing_dual_read") dualReadLogs.push(parsed);
    } catch {
      /* ignore */
    }
  };

  let outcome;
  try {
    outcome = await routeGithubLabeledEventToFlowWaits(
      {
        installationId: 99,
        repoId: null,
        repoFullName: "alice/dotfiles",
        accountType: "User",
        labelName: "ready",
        isPullRequest: true,
        deliveryId: "d-dual",
        payload: { action: "labeled" },
      },
      {
        findCandidates: async () => candidates,
        resumeWait: async ({ candidate }) => {
          resumeCalls.push(candidate.id);
          return { resumed: true, resumeToken: candidate.resume_token };
        },
        loadStartFilters: async () =>
          new Map([["flow-org-only", { scope: "org" as const }]]),
      }
    );
  } finally {
    console.log = originalLog;
  }

  assert.equal(outcome.matched, 1);
  assert.equal(
    outcome.resumed,
    1,
    "shadow mode: resume is not gated by filter"
  );
  assert.deepEqual(resumeCalls, ["wait-1"]);
  assert.equal(dualReadLogs.length, 1);
  assert.equal(dualReadLogs[0]?.waits_id_matched, 1);
  assert.equal(dualReadLogs[0]?.waits_filter_matched, 0);
  assert.deepEqual(dualReadLogs[0]?.diff_wait_ids, ["wait-1"]);
});

test("routeGithubCommentAddedEventToFlowWaits matches thread, author, text, and PR scope", async () => {
  const { routeGithubCommentAddedEventToFlowWaits } = await loadWaitService();
  const candidates = [
    {
      id: "comment-match",
      user_id: "u",
      job_run_id: "j1",
      flow_id: "f",
      installation_id: 99 as number | null,
      repo_id: "repo-1" as string | null,
      node_id: "n1",
      wait_kind: "github_comment_added" as const,
      wait_config: {
        kind: "github_comment_added" as const,
        bodyContains: "ready to ship",
        authorLogin: "Alice",
        prOnly: true,
        matchTriggerIssue: true,
        expectedIssueNumber: 42,
      },
      resume_token: "tok-comment",
    },
    {
      id: "wrong-thread",
      user_id: "u",
      job_run_id: "j2",
      flow_id: "f",
      installation_id: 99 as number | null,
      repo_id: "repo-1" as string | null,
      node_id: "n2",
      wait_kind: "github_comment_added" as const,
      wait_config: {
        kind: "github_comment_added" as const,
        bodyContains: "",
        authorLogin: "",
        prOnly: true,
        matchTriggerIssue: true,
        expectedIssueNumber: 99,
      },
      resume_token: "tok-other",
    },
    {
      id: "wrong-author",
      user_id: "u",
      job_run_id: "j3",
      flow_id: "f",
      installation_id: 99 as number | null,
      repo_id: "repo-1" as string | null,
      node_id: "n3",
      wait_kind: "github_comment_added" as const,
      wait_config: {
        kind: "github_comment_added" as const,
        bodyContains: "",
        authorLogin: "bob",
        prOnly: false,
        matchTriggerIssue: false,
        expectedIssueNumber: null,
      },
      resume_token: "tok-author",
    },
  ];
  const resumed: string[] = [];

  const outcome = await routeGithubCommentAddedEventToFlowWaits(
    {
      installationId: 99,
      repoId: "repo-1",
      issueNumber: 42,
      isPullRequest: true,
      authorLogin: "alice",
      body: "Looks READY TO SHIP from my side.",
      deliveryId: "delivery-comment",
      payload: { action: "created" },
    },
    {
      findCandidates: async () => candidates,
      resumeWait: async ({ candidate }) => {
        resumed.push(candidate.id);
        return { resumed: true, resumeToken: candidate.resume_token };
      },
    }
  );

  assert.equal(outcome.matched, 1);
  assert.equal(outcome.resumed, 1);
  assert.deepEqual(resumed, ["comment-match"]);
});

test("routeGithubCiCompletedEventToFlowWaits matches workflow, conclusion, and triggering SHA", async () => {
  const { routeGithubCiCompletedEventToFlowWaits } = await loadWaitService();
  const candidates = [
    {
      id: "ci-match",
      user_id: "u",
      job_run_id: "j1",
      flow_id: "f",
      installation_id: 99 as number | null,
      repo_id: "repo-1" as string | null,
      node_id: "n1",
      wait_kind: "ci_workflow_completed" as const,
      wait_config: {
        kind: "ci_workflow_completed" as const,
        workflowName: "CI / test",
        conclusion: "success" as const,
        matchTriggerSha: true,
        expectedSha: "abc123",
      },
      resume_token: "tok-ci",
    },
    {
      id: "ci-other-sha",
      user_id: "u",
      job_run_id: "j2",
      flow_id: "f",
      installation_id: 99 as number | null,
      repo_id: "repo-1" as string | null,
      node_id: "n2",
      wait_kind: "ci_workflow_completed" as const,
      wait_config: {
        kind: "ci_workflow_completed" as const,
        workflowName: "CI / test",
        conclusion: "success" as const,
        matchTriggerSha: true,
        expectedSha: "different",
      },
      resume_token: "tok-other",
    },
  ];
  const resumed: string[] = [];

  const outcome = await routeGithubCiCompletedEventToFlowWaits(
    {
      installationId: 99,
      repoId: "repo-1",
      workflowName: "ci / TEST",
      conclusion: "success",
      headSha: "ABC123",
      deliveryId: "delivery-ci",
      payload: { action: "completed" },
    },
    {
      findCandidates: async () => candidates,
      resumeWait: async ({ candidate }) => {
        resumed.push(candidate.id);
        return { resumed: true, resumeToken: candidate.resume_token };
      },
    }
  );

  assert.equal(outcome.matched, 1);
  assert.equal(outcome.resumed, 1);
  assert.deepEqual(resumed, ["ci-match"]);
});

test("routeGithubVercelPreviewReadyEventToFlowWaits matches environment and triggering SHA", async () => {
  const { routeGithubVercelPreviewReadyEventToFlowWaits } =
    await loadWaitService();
  const candidates = [
    {
      id: "preview-match",
      user_id: "u",
      job_run_id: "j1",
      flow_id: "f",
      installation_id: 99 as number | null,
      repo_id: "repo-1" as string | null,
      node_id: "n1",
      wait_kind: "vercel_preview_ready" as const,
      wait_config: {
        kind: "vercel_preview_ready" as const,
        environment: "Preview",
        matchTriggerSha: true,
        expectedSha: "abc123",
      },
      resume_token: "tok-preview",
    },
  ];
  const resumed: string[] = [];

  const outcome = await routeGithubVercelPreviewReadyEventToFlowWaits(
    {
      installationId: 99,
      repoId: "repo-1",
      environment: "preview",
      sha: "abc123",
      deliveryId: "delivery-preview",
      payload: { deployment_status: { state: "success" } },
    },
    {
      findCandidates: async () => candidates,
      resumeWait: async ({ candidate }) => {
        resumed.push(candidate.id);
        return { resumed: true, resumeToken: candidate.resume_token };
      },
    }
  );

  assert.equal(outcome.matched, 1);
  assert.equal(outcome.resumed, 1);
  assert.deepEqual(resumed, ["preview-match"]);
});

test("findActiveFlowWaitsForEvent refuses to query when installationId is null", async () => {
  const { findActiveFlowWaitsForEvent } = await loadWaitService();
  let queriedSupabase = false;
  await withFetch(
    async ({ url }) => {
      if (url.includes("/rest/v1/flow_waits")) {
        queriedSupabase = true;
      }
      return Response.json([]);
    },
    async () => {
      const candidates = await findActiveFlowWaitsForEvent({
        installationId: null,
        waitKind: "github_label_added",
        repoId: "repo-1",
      });
      assert.deepEqual(candidates, []);
      assert.equal(queriedSupabase, false);
    }
  );
});

test("findActiveFlowWaitsForEvent restricts to repo-agnostic waits when no repoId is provided", async () => {
  const { findActiveFlowWaitsForEvent } = await loadWaitService();
  let queriedUrl: string | null = null;
  await withFetch(
    async ({ url }) => {
      if (url.includes("/rest/v1/flow_waits")) {
        queriedUrl = url;
        return Response.json([]);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    },
    async () => {
      await findActiveFlowWaitsForEvent({
        installationId: 99,
        waitKind: "github_label_added",
      });
    }
  );
  assert.ok(queriedUrl, "expected a Supabase query");
  assert.match(queriedUrl!, /repo_id=is\.null/);
  assert.match(queriedUrl!, /installation_id=eq\.99/);
});
