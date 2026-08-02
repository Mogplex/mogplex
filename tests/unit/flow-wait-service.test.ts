import assert from "node:assert/strict";
import test from "node:test";

process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "service-role-key";

type FetchHandler = (request: {
  url: string;
  method: string;
  body: string | null;
}) => Response | Promise<Response>;

async function withFetch<T>(
  handler: FetchHandler,
  fn: () => Promise<T>
): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    const method = (init?.method ?? "GET").toUpperCase();
    const body =
      typeof init?.body === "string"
        ? init.body
        : init?.body
          ? String(init.body)
          : null;
    return handler({ url, method, body });
  }) as typeof globalThis.fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

async function loadWaitService() {
  return import("../../lib/flows/wait-service");
}

test("resumeFlowWait wins exactly one CAS update and completes the wait token once", async () => {
  const { resumeFlowWait } = await loadWaitService();

  const candidate = {
    id: "wait-1",
    user_id: "user-1",
    job_run_id: "job-1",
    flow_id: "flow-1",
    installation_id: 99 as number | null,
    repo_id: "repo-1" as string | null,
    node_id: "await-1",
    wait_kind: "github_label_added" as const,
    wait_config: {
      kind: "github_label_added" as const,
      labelName: "ready",
      prOnly: true,
    },
    resume_token: "tok-abc",
  };

  let updateCalls = 0;
  let completeCalls: Array<{ tokenId: string; payload: unknown }> = [];

  await withFetch(
    async ({ url, method }) => {
      if (url.includes("/rest/v1/flow_waits") && method === "PATCH") {
        updateCalls += 1;
        // First call wins; subsequent calls return zero rows because the
        // status check `eq("status", "waiting")` no longer matches.
        if (updateCalls === 1) {
          return Response.json({ resume_token: candidate.resume_token });
        }
        return Response.json(null, { status: 200 });
      }
      throw new Error(`Unexpected ${method} ${url}`);
    },
    async () => {
      const first = await resumeFlowWait(
        {
          candidate,
          payload: { delivery_id: "d-1" },
          deliveryId: "d-1",
        },
        {
          completeWaitToken: async (tokenId, payload) => {
            completeCalls.push({ tokenId, payload });
          },
        }
      );

      const second = await resumeFlowWait(
        {
          candidate,
          payload: { delivery_id: "d-2" },
          deliveryId: "d-2",
        },
        {
          completeWaitToken: async (tokenId, payload) => {
            completeCalls.push({ tokenId, payload });
          },
        }
      );

      assert.deepEqual(first, {
        resumed: true,
        resumeToken: candidate.resume_token,
      });
      assert.equal(second.resumed, false);
      if (!second.resumed) {
        assert.equal(second.reason, "already_resumed");
      }
      assert.equal(completeCalls.length, 1);
      assert.equal(completeCalls[0]?.tokenId, candidate.resume_token);
    }
  );
});

test("resumeFlowWait rolls the row back when wait.completeToken throws", async () => {
  const { resumeFlowWait } = await loadWaitService();

  const candidate = {
    id: "wait-2",
    user_id: "user-1",
    job_run_id: "job-2",
    flow_id: "flow-1",
    installation_id: 99 as number | null,
    repo_id: null,
    node_id: "await-1",
    wait_kind: "github_label_added" as const,
    wait_config: {
      kind: "github_label_added" as const,
      labelName: "ship-it",
      prOnly: true,
    },
    resume_token: "tok-xyz",
  };

  const patchBodies: string[] = [];
  await withFetch(
    async ({ url, method, body }) => {
      if (url.includes("/rest/v1/flow_waits") && method === "PATCH") {
        patchBodies.push(body ?? "");
        // First PATCH = the CAS resume update; second PATCH = the rollback.
        if (patchBodies.length === 1) {
          return Response.json({ resume_token: candidate.resume_token });
        }
        return Response.json(null, { status: 200 });
      }
      throw new Error(`Unexpected ${method} ${url}`);
    },
    async () => {
      const result = await resumeFlowWait(
        {
          candidate,
          payload: { delivery_id: "d-3" },
          deliveryId: "d-3",
        },
        {
          completeWaitToken: async () => {
            throw new Error("trigger.dev unavailable");
          },
        }
      );

      assert.equal(result.resumed, false);
      if (!result.resumed) {
        assert.equal(result.reason, "complete_failed");
        assert.equal(result.rollbackFailed, undefined);
      }
      assert.equal(patchBodies.length, 2);
      const rollback = JSON.parse(patchBodies[1]!) as Record<string, unknown>;
      assert.equal(rollback.status, "waiting");
      assert.equal(rollback.resumed_at, null);
      assert.equal(rollback.resume_payload, null);
      assert.equal(rollback.resume_delivery_id, null);
    }
  );
});

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

  // Issue-scoped delivery (isPullRequest=false) so the prOnly:true candidate
  // should skip; the other prOnly:true match also skips for the same reason.
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

test("resumeFlowWait surfaces rollbackFailed when both completeToken and the rollback throw", async () => {
  const { resumeFlowWait } = await loadWaitService();

  const candidate = {
    id: "wait-3",
    user_id: "user-1",
    job_run_id: "job-3",
    flow_id: "flow-1",
    installation_id: 99 as number | null,
    repo_id: "repo-1" as string | null,
    node_id: "await-1",
    wait_kind: "github_label_added" as const,
    wait_config: {
      kind: "github_label_added" as const,
      labelName: "broken",
      prOnly: true,
    },
    resume_token: "tok-broken",
  };

  let patchCount = 0;
  await withFetch(
    async ({ url, method }) => {
      if (url.includes("/rest/v1/flow_waits") && method === "PATCH") {
        patchCount += 1;
        if (patchCount === 1) {
          return Response.json({ resume_token: candidate.resume_token });
        }
        // The rollback PATCH itself fails. Supabase reports the error in the
        // body; the helper should detect it and surface rollbackFailed=true so
        // an operator knows the row is stuck in `resumed`.
        return Response.json(
          { code: "PGRST500", message: "rollback failed" },
          { status: 500 }
        );
      }
      throw new Error(`Unexpected ${method} ${url}`);
    },
    async () => {
      const result = await resumeFlowWait(
        {
          candidate,
          payload: { delivery_id: "d-broken" },
          deliveryId: "d-broken",
        },
        {
          completeWaitToken: async () => {
            throw new Error("trigger.dev unavailable");
          },
        }
      );

      assert.equal(result.resumed, false);
      if (!result.resumed) {
        assert.equal(result.reason, "complete_failed");
        assert.equal(result.rollbackFailed, true);
      }
      assert.equal(patchCount, 2);
    }
  );
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
      // No fetch should have been issued — broadening the search across all
      // installations is the exact cross-tenant leak we're guarding against.
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
  // The query must pin repo_id IS NULL so we never broaden to every repo in
  // the installation.
  assert.ok(queriedUrl, "expected a Supabase query");
  assert.match(queriedUrl!, /repo_id=is\.null/);
  assert.match(queriedUrl!, /installation_id=eq\.99/);
});

test("resumeFlowWait applies the not-expired guard to the CAS when notExpiredAt is set", async () => {
  const { resumeFlowWait } = await loadWaitService();

  const candidate = {
    id: "wait-approval-1",
    user_id: "user-1",
    job_run_id: "job-1",
    flow_id: "flow-1",
    installation_id: 99 as number | null,
    repo_id: "repo-1" as string | null,
    node_id: "node-1",
    wait_kind: "tool_approval" as const,
    wait_config: {
      kind: "tool_approval" as const,
      toolName: "updateFile",
      toolCallId: "call-1",
      toolInput: "{}",
      nodeId: "node-1",
      nodeLabel: "Review",
      agentName: null,
      repoFullName: null,
    },
    resume_token: "tok-approval",
  };

  const patchUrls: string[] = [];
  const outcome = await withFetch(
    async ({ url, method }) => {
      if (url.includes("/rest/v1/flow_waits") && method === "PATCH") {
        patchUrls.push(url);
        // Simulate an expired row: the extra expires_at filter matches no row.
        return Response.json(null, { status: 200 });
      }
      throw new Error(`Unexpected ${method} ${url}`);
    },
    () =>
      resumeFlowWait(
        {
          candidate,
          payload: { decision: "approve" },
          deliveryId: null,
          notExpiredAt: "2026-07-22T12:00:00.000Z",
        },
        {
          completeWaitToken: async () => {
            throw new Error(
              "must not complete a token when the CAS matched no row"
            );
          },
        }
      )
  );

  assert.equal(patchUrls.length, 1);
  assert.ok(
    patchUrls[0].includes("expires_at=gt."),
    `CAS update must carry the expires_at guard, got: ${patchUrls[0]}`
  );
  assert.deepEqual(outcome, { resumed: false, reason: "already_resumed" });
});
