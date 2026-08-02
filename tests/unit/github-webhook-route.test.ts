import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import type { TriggerEvent } from "../../lib/types";

async function loadGithubWebhookRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/webhooks/github/route");
}

test("pickWebhookRepoForUser prefers the root repo over subproject spaces", async () => {
  const { pickWebhookRepoForUser } = await loadGithubWebhookRoute();

  const repo = pickWebhookRepoForUser(
    [
      {
        id: "repo-web",
        user_id: "user-1",
        full_name: "webrenew/credit-renew",
        root_directory: "web",
        parent_repo_id: "repo-root",
      },
      {
        id: "repo-root",
        user_id: "user-1",
        full_name: "webrenew/credit-renew",
        root_directory: null,
        parent_repo_id: null,
      },
    ],
    "user-1"
  );

  assert.equal(repo?.id, "repo-root");
});

test("buildFlowWebhookJobs uses flow ownership instead of singleton repo ownership", async () => {
  const { buildFlowWebhookJobs } = await loadGithubWebhookRoute();

  const jobs = buildFlowWebhookJobs({
    flows: [
      {
        id: "flow-1",
        user_id: "user-a",
        installation_id: 117860437,
        published_version_id: "version-1",
        published_version: {
          id: "version-1",
          graph: {
            nodes: [
              {
                id: "start",
                type: "start",
                position: { x: 0, y: 0 },
                data: { label: "PR opened", event: "pr_opened" },
              },
              {
                id: "agent-1",
                type: "agent",
                position: { x: 100, y: 0 },
                data: { label: "Reviewer", agentId: "agent-1" },
              },
              {
                id: "end",
                type: "end",
                position: { x: 200, y: 0 },
                data: { label: "Done" },
              },
            ],
            edges: [
              { id: "start-agent", source: "start", target: "agent-1" },
              { id: "agent-end", source: "agent-1", target: "end" },
            ],
            viewport: { x: 0, y: 0, zoom: 1 },
          },
        },
      },
    ],
    results: [
      {
        assignmentType: "pr_review",
        triggerEvent: "pr_opened",
        metadata: {
          pr_number: 42,
          pr_url: "https://github.com/webrenew/credit-renew/pull/42",
        },
      },
    ],
    repoRows: [
      {
        id: "repo-user-a",
        user_id: "user-a",
        full_name: "webrenew/credit-renew",
        product_team_id: "00000000-0000-4000-8000-00000000000a",
        root_directory: null,
        parent_repo_id: null,
      },
      {
        id: "repo-user-b",
        user_id: "user-b",
        full_name: "webrenew/credit-renew",
        product_team_id: "00000000-0000-4000-8000-00000000000b",
        root_directory: null,
        parent_repo_id: null,
      },
    ],
    payload: '{"action":"opened"}',
    deliveryId: "delivery-1",
    repoFullName: "webrenew/credit-renew",
    agentSlugsById: new Map([["agent-1", "reviewer"]]),
  });

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]?.userId, "user-a");
  assert.equal(jobs[0]?.flow_id, "flow-1");
  assert.equal(jobs[0]?.scope.sourceKind, "flow");
  assert.equal(jobs[0]?.scope.repoId, "repo-user-a");
  assert.equal(jobs[0]?.metadata.repo_id, "repo-user-a");
  assert.equal(
    jobs[0]?.metadata.team_id,
    "00000000-0000-4000-8000-00000000000a"
  );
});

test("buildFlowWebhookJobs routes bare @mogplex mentions to active mention flows", async () => {
  const { buildFlowWebhookJobs } = await loadGithubWebhookRoute();

  const jobs = buildFlowWebhookJobs({
    flows: [
      {
        id: "flow-mention",
        user_id: "user-a",
        installation_id: 117860437,
        published_version_id: "version-mention",
        published_version: {
          id: "version-mention",
          graph: {
            nodes: [
              {
                id: "start",
                type: "start",
                position: { x: 0, y: 0 },
                data: {
                  label: "@mogplex",
                  event: "mention",
                  isDefault: false,
                },
              },
              {
                id: "agent-1",
                type: "agent",
                position: { x: 100, y: 0 },
                data: { label: "Reviewer", agentId: "agent-1" },
              },
              {
                id: "end",
                type: "end",
                position: { x: 200, y: 0 },
                data: { label: "Done" },
              },
            ],
            edges: [
              { id: "start-agent", source: "start", target: "agent-1" },
              { id: "agent-end", source: "agent-1", target: "end" },
            ],
            viewport: { x: 0, y: 0, zoom: 1 },
          },
        },
      },
    ],
    results: [
      {
        assignmentType: "mention",
        triggerEvent: "mention",
        metadata: {
          comment_id: 123,
          comment_body: "@mogplex please fix these issues.",
        },
        agentSlug: null,
      },
    ],
    repoRows: [
      {
        id: "repo-user-a",
        user_id: "user-a",
        full_name: "webrenew/mogplex-tui",
        root_directory: null,
        parent_repo_id: null,
      },
    ],
    payload: '{"action":"created"}',
    deliveryId: "delivery-mention",
    repoFullName: "webrenew/mogplex-tui",
    agentSlugsById: new Map([["agent-1", "nextjs-reviewer"]]),
  });

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]?.flow_id, "flow-mention");
  assert.equal(jobs[0]?.scope.sourceType, "mention");
  assert.equal(
    jobs[0]?.metadata.comment_body,
    "@mogplex please fix these issues."
  );
});

test("buildFlowWebhookJobs routes owner flows across installations when start filter allows it", async () => {
  const { buildFlowWebhookJobs } = await loadGithubWebhookRoute();

  const jobs = buildFlowWebhookJobs({
    flows: [
      {
        id: "flow-webrenew",
        user_id: "user-a",
        installation_id: 121640727,
        published_version_id: "version-mention",
        published_version: {
          id: "version-mention",
          graph: {
            nodes: [
              {
                id: "start",
                type: "start",
                position: { x: 0, y: 0 },
                data: {
                  label: "@mogplex",
                  event: "mention",
                  isDefault: true,
                },
              },
              {
                id: "agent-1",
                type: "agent",
                position: { x: 100, y: 0 },
                data: { label: "Reviewer", agentId: "agent-1" },
              },
              {
                id: "end",
                type: "end",
                position: { x: 200, y: 0 },
                data: { label: "Done" },
              },
            ],
            edges: [
              { id: "start-agent", source: "start", target: "agent-1" },
              { id: "agent-end", source: "agent-1", target: "end" },
            ],
            viewport: { x: 0, y: 0, zoom: 1 },
          },
        },
      },
    ],
    results: [
      {
        assignmentType: "mention",
        triggerEvent: "mention",
        metadata: {
          comment_id: 3327648361,
          comment_body: "@mogplex create a GH issue for this",
          is_pr: true,
          issue_number: 26,
        },
        agentSlug: null,
      },
    ],
    repoRows: [
      {
        id: "repo-casint",
        user_id: "user-a",
        full_name: "charlesrhoward/casint",
        github_installation_id: 126303866,
        root_directory: null,
        parent_repo_id: null,
      },
    ],
    payload: '{"action":"created"}',
    deliveryId: "delivery-cross-installation",
    repoFullName: "charlesrhoward/casint",
    agentSlugsById: new Map([["agent-1", "nextjs-reviewer"]]),
    installationId: 126303866,
    accountType: "User",
  });

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]?.flow_id, "flow-webrenew");
  assert.equal(jobs[0]?.scope.repoId, "repo-casint");
  assert.equal(jobs[0]?.scope.installationId, 126303866);
  assert.equal(jobs[0]?.metadata.repo_full_name, "charlesrhoward/casint");
  assert.equal(jobs[0]?.metadata.installation_id, 126303866);
});

// Flow filter routing keeps the historical parity log fields so production
// checks can still compare the candidate set against the eligible subset.

type DualReadLog = {
  event: string;
  flows_id_matched: number;
  flows_filter_matched: number;
  flows_no_filter: number;
  diff_flow_ids: string[];
  installation_id: number;
  account_type: "User" | "Organization";
};

function captureDualReadLogs(run: () => unknown): DualReadLog[] {
  const original = console.log;
  const logs: DualReadLog[] = [];
  console.log = (message: unknown) => {
    if (typeof message !== "string") return;
    try {
      const parsed = JSON.parse(message) as DualReadLog;
      if (parsed.event === "flow_routing_dual_read") logs.push(parsed);
    } catch {
      /* ignore non-JSON log lines */
    }
  };
  try {
    run();
  } finally {
    console.log = original;
  }
  return logs;
}

function buildPrOpenedFlowFixture(filter: unknown) {
  return {
    id: "flow-1",
    user_id: "user-a",
    installation_id: 117860437,
    published_version_id: "version-1",
    published_version: {
      id: "version-1",
      graph: {
        nodes: [
          {
            id: "start",
            type: "start",
            position: { x: 0, y: 0 },
            data: { label: "PR opened", event: "pr_opened", filter },
          },
          {
            id: "agent-1",
            type: "agent",
            position: { x: 100, y: 0 },
            data: { label: "Reviewer", agentId: "agent-1" },
          },
          {
            id: "end",
            type: "end",
            position: { x: 200, y: 0 },
            data: { label: "Done" },
          },
        ],
        edges: [
          { id: "start-agent", source: "start", target: "agent-1" },
          { id: "agent-end", source: "agent-1", target: "end" },
        ],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    },
  };
}

const PR_OPENED_RESULT = {
  assignmentType: "pr_review",
  triggerEvent: "pr_opened" as const,
  metadata: { pr_number: 1, pr_url: "https://github.com/acme/web/pull/1" },
};

const REPO_FIXTURE = [
  {
    id: "repo-user-a",
    user_id: "user-a",
    full_name: "acme/web",
    root_directory: null,
    parent_repo_id: null,
  },
];

test("buildFlowWebhookJobs dual-read routes a flow with no start.filter and reports flows_no_filter", async () => {
  const { buildFlowWebhookJobs } = await loadGithubWebhookRoute();
  let jobs: unknown[] = [];
  const logs = captureDualReadLogs(() => {
    jobs = buildFlowWebhookJobs({
      flows: [buildPrOpenedFlowFixture(undefined)],
      results: [PR_OPENED_RESULT],
      repoRows: REPO_FIXTURE,
      payload: '{"action":"opened"}',
      deliveryId: "delivery-no-filter",
      repoFullName: "acme/web",
      agentSlugsById: new Map([["agent-1", "reviewer"]]),
      installationId: 117860437,
      accountType: "Organization",
    });
  });

  assert.equal(jobs.length, 1, "parity: flow without filter still routes");
  assert.equal(logs.length, 1);
  assert.equal(logs[0]?.flows_id_matched, 1);
  assert.equal(logs[0]?.flows_filter_matched, 1);
  assert.equal(logs[0]?.flows_no_filter, 1);
  assert.deepEqual(logs[0]?.diff_flow_ids, []);
});

test("buildFlowWebhookJobs drops a flow whose start.filter rejects the delivery", async () => {
  const { buildFlowWebhookJobs } = await loadGithubWebhookRoute();
  let jobs: unknown[] = [];
  const logs = captureDualReadLogs(() => {
    jobs = buildFlowWebhookJobs({
      flows: [buildPrOpenedFlowFixture({ scope: "personal" })],
      results: [PR_OPENED_RESULT],
      repoRows: REPO_FIXTURE,
      payload: '{"action":"opened"}',
      deliveryId: "delivery-mismatch",
      repoFullName: "acme/web",
      agentSlugsById: new Map([["agent-1", "reviewer"]]),
      installationId: 117860437,
      accountType: "Organization",
    });
  });

  assert.equal(jobs.length, 0);
  assert.equal(logs[0]?.flows_filter_matched, 0);
  assert.deepEqual(logs[0]?.diff_flow_ids, ["flow-1"]);
});

test("buildFlowWebhookJobs dual-read reports clean parity when the filter matches", async () => {
  const { buildFlowWebhookJobs } = await loadGithubWebhookRoute();
  let jobs: unknown[] = [];
  const logs = captureDualReadLogs(() => {
    jobs = buildFlowWebhookJobs({
      flows: [
        buildPrOpenedFlowFixture({
          scope: "all",
          installationIds: [117860437],
        }),
      ],
      results: [PR_OPENED_RESULT],
      repoRows: REPO_FIXTURE,
      payload: '{"action":"opened"}',
      deliveryId: "delivery-clean",
      repoFullName: "acme/web",
      agentSlugsById: new Map([["agent-1", "reviewer"]]),
      installationId: 117860437,
      accountType: "Organization",
    });
  });

  assert.equal(jobs.length, 1);
  assert.equal(logs[0]?.flows_id_matched, 1);
  assert.equal(logs[0]?.flows_filter_matched, 1);
  assert.equal(logs[0]?.flows_no_filter, 0);
  assert.deepEqual(logs[0]?.diff_flow_ids, []);
});

test("handlePullRequest includes branch metadata for fixer handoff", async () => {
  const { handlePullRequest } = await loadGithubWebhookRoute();

  const results = handlePullRequest({
    action: "opened",
    pull_request: {
      number: 42,
      html_url: "https://github.com/webrenew/credit-renew/pull/42",
      title: "Fix race condition",
      user: { login: "octocat", type: "User" },
      head: {
        ref: "fix/race-condition",
        sha: "abc123",
        repo: { full_name: "octocat/credit-renew-fork" },
      },
      base: {
        ref: "main",
        sha: "def456",
        repo: { full_name: "webrenew/credit-renew" },
      },
    },
  });

  assert.deepEqual(results, [
    {
      assignmentType: "pr_review",
      triggerEvent: "pr_opened",
      metadata: {
        pr_number: 42,
        pr_url: "https://github.com/webrenew/credit-renew/pull/42",
        pr_title: "Fix race condition",
        pr_author: "octocat",
        head_ref: "fix/race-condition",
        head_sha: "abc123",
        head_repo_full_name: "octocat/credit-renew-fork",
        base_ref: "main",
        base_sha: "def456",
        base_repo_full_name: "webrenew/credit-renew",
      },
      authorLogin: "octocat",
      authorIsBot: false,
    },
  ]);
});

test("handlePullRequest triggers reviews when a draft becomes ready and when a PR is reopened", async () => {
  const { handlePullRequest } = await loadGithubWebhookRoute();

  const draftOpenedResults = handlePullRequest({
    action: "opened",
    pull_request: {
      number: 42,
      html_url: "https://github.com/webrenew/credit-renew/pull/42",
      title: "Draft fix",
      draft: true,
    },
  });

  const draftSynchronizeResults = handlePullRequest({
    action: "synchronize",
    pull_request: {
      number: 42,
      html_url: "https://github.com/webrenew/credit-renew/pull/42",
      title: "Draft fix",
      draft: true,
    },
  });

  const readyResults = handlePullRequest({
    action: "ready_for_review",
    pull_request: {
      number: 42,
      html_url: "https://github.com/webrenew/credit-renew/pull/42",
      title: "Finish draft",
    },
  });

  const reopenedResults = handlePullRequest({
    action: "reopened",
    pull_request: {
      number: 42,
      html_url: "https://github.com/webrenew/credit-renew/pull/42",
      title: "Reopen fix",
    },
  });

  assert.deepEqual(draftOpenedResults, []);
  assert.deepEqual(draftSynchronizeResults, []);

  assert.deepEqual(readyResults, [
    {
      assignmentType: "pr_review",
      triggerEvent: "pr_opened",
      metadata: {
        pr_number: 42,
        pr_url: "https://github.com/webrenew/credit-renew/pull/42",
        pr_title: "Finish draft",
        pr_author: null,
        head_ref: null,
        head_sha: null,
        head_repo_full_name: null,
        base_ref: null,
        base_sha: null,
        base_repo_full_name: null,
      },
      authorLogin: null,
      authorIsBot: false,
    },
  ]);

  assert.deepEqual(reopenedResults, [
    {
      assignmentType: "pr_review",
      triggerEvent: "pr_opened",
      metadata: {
        pr_number: 42,
        pr_url: "https://github.com/webrenew/credit-renew/pull/42",
        pr_title: "Reopen fix",
        pr_author: null,
        head_ref: null,
        head_sha: null,
        head_repo_full_name: null,
        base_ref: null,
        base_sha: null,
        base_repo_full_name: null,
      },
      authorLogin: null,
      authorIsBot: false,
    },
  ]);
});

test("buildFlowWebhookJobs applies the start-filter authorFilter to PR events", async () => {
  const { buildFlowWebhookJobs } = await loadGithubWebhookRoute();

  const makeFlow = (
    flowId: string,
    authorFilter: "exclude_dependabot" | "dependabot_only"
  ) => ({
    id: flowId,
    user_id: "user-a",
    installation_id: 117860437,
    published_version_id: `${flowId}-version`,
    published_version: {
      id: `${flowId}-version`,
      graph: {
        nodes: [
          {
            id: "start",
            type: "start",
            position: { x: 0, y: 0 },
            data: {
              label: "PR opened",
              event: "pr_opened",
              filter: { scope: "all", authorFilter },
            },
          },
          {
            id: "agent-1",
            type: "agent",
            position: { x: 100, y: 0 },
            data: { label: "Reviewer", agentId: "agent-1" },
          },
          {
            id: "end",
            type: "end",
            position: { x: 200, y: 0 },
            data: { label: "Done" },
          },
        ],
        edges: [
          { id: "start-agent", source: "start", target: "agent-1" },
          { id: "agent-end", source: "agent-1", target: "end" },
        ],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    },
  });

  const makeInput = (authorLogin: string, authorIsBot: boolean) => ({
    flows: [
      makeFlow("flow-exclude", "exclude_dependabot" as const),
      makeFlow("flow-only", "dependabot_only" as const),
    ],
    results: [
      {
        assignmentType: "pr_review",
        triggerEvent: "pr_opened" as const,
        metadata: {
          pr_number: 42,
          pr_url: "https://github.com/webrenew/vmotif/pull/42",
        },
        authorLogin,
        authorIsBot,
      },
    ],
    repoRows: [
      {
        id: "repo-user-a",
        user_id: "user-a",
        full_name: "webrenew/vmotif",
        root_directory: null,
        parent_repo_id: null,
      },
    ],
    payload: '{"action":"opened"}',
    deliveryId: "delivery-1",
    repoFullName: "webrenew/vmotif",
    agentSlugsById: new Map([["agent-1", "reviewer"]]),
    installationId: 117860437,
    accountType: "Organization" as const,
  });

  const dependabotJobs = buildFlowWebhookJobs(
    makeInput("dependabot[bot]", true)
  );
  assert.deepEqual(
    dependabotJobs.map((job) => job.flow_id),
    ["flow-only"]
  );

  const humanJobs = buildFlowWebhookJobs(makeInput("octocat", false));
  assert.deepEqual(
    humanJobs.map((job) => job.flow_id),
    ["flow-exclude"]
  );
});

test("handlePullRequest surfaces dependabot as the PR author", async () => {
  const { handlePullRequest } = await loadGithubWebhookRoute();

  const results = handlePullRequest({
    action: "opened",
    pull_request: {
      number: 7,
      html_url: "https://github.com/webrenew/vmotif/pull/7",
      title: "chore(deps): bump next from 15.3.1 to 15.3.2",
      user: { login: "dependabot[bot]", type: "Bot" },
    },
  });

  assert.equal(results.length, 1);
  assert.equal(results[0]?.authorLogin, "dependabot[bot]");
  assert.equal(results[0]?.authorIsBot, true);
  assert.equal(results[0]?.metadata.pr_author, "dependabot[bot]");
});

test("handlePullRequest skips bot-authored synchronize events to avoid fix loops", async () => {
  const { handlePullRequest } = await loadGithubWebhookRoute();

  const results = handlePullRequest({
    action: "synchronize",
    sender: {
      login: "mogplex[bot]",
      type: "Bot",
    },
    pull_request: {
      number: 42,
      html_url: "https://github.com/webrenew/credit-renew/pull/42",
    },
  });

  assert.deepEqual(results, []);
});

test("handleCIEvent ignores Mogplex PR review check runs", async () => {
  const { handleCIEvent } = await loadGithubWebhookRoute();

  const results = handleCIEvent("check_run", {
    action: "completed",
    check_run: {
      conclusion: "failure",
      name: "Mogplex PR Review",
      head_sha: "abc123",
      details_url: "https://github.com/webrenew/credit-renew/runs/1",
    },
  });

  assert.deepEqual(results, []);
});

test("isPrReviewCheckRunRetryRequest recognizes requested actions and rerequests", async () => {
  const { isPrReviewCheckRunRetryRequest } = await loadGithubWebhookRoute();

  assert.equal(
    isPrReviewCheckRunRetryRequest({
      action: "requested_action",
      requested_action: {
        identifier: "rerun-pr-review",
      },
      check_run: {
        name: "Mogplex PR Review",
      },
    }),
    true
  );

  assert.equal(
    isPrReviewCheckRunRetryRequest({
      action: "rerequested",
      check_run: {
        name: "Mogplex PR Review",
      },
    }),
    true
  );

  assert.equal(
    isPrReviewCheckRunRetryRequest({
      action: "requested_action",
      requested_action: {
        identifier: "rerun-pr-review",
      },
      check_run: {
        name: "Some Other Check",
      },
    }),
    false
  );
});

test("doesCheckRunRetryContextMatchWebhookRepo requires an exact repo match when repoId is present", async () => {
  const { doesCheckRunRetryContextMatchWebhookRepo } =
    await loadGithubWebhookRoute();

  assert.equal(
    doesCheckRunRetryContextMatchWebhookRepo({
      repoRows: [
        {
          id: "repo-a",
          user_id: "user-a",
          github_installation_id: 117860437,
        },
      ],
      repoId: "repo-b",
      installationId: 117860437,
      webhookInstallationId: 117860437,
    }),
    false
  );

  assert.equal(
    doesCheckRunRetryContextMatchWebhookRepo({
      repoRows: [
        {
          id: "repo-a",
          user_id: "user-a",
          github_installation_id: 117860437,
        },
      ],
      repoId: "repo-a",
      installationId: 117860437,
      webhookInstallationId: 117860437,
    }),
    true
  );

  assert.equal(
    doesCheckRunRetryContextMatchWebhookRepo({
      repoRows: [
        {
          id: "repo-a",
          user_id: "user-a",
          github_installation_id: 117860437,
        },
      ],
      repoId: null,
      installationId: 117860437,
      webhookInstallationId: 117860437,
    }),
    true
  );
});

function buildCheckRunRetryResponseInput(deliveryId = "delivery-rerun-1") {
  return {
    context: {
      event: "check_run",
      deliveryId,
      signature: "sha256=test",
      globalSecret: null,
      payload: JSON.stringify({ deliveryId }),
      body: {
        action: "requested_action",
        requested_action: { identifier: "rerun-pr-review" },
        check_run: {
          id: 91,
          name: "Mogplex PR Review",
          external_id: "job-1",
        },
      },
      installationId: 117860437,
      repoGithubId: 42,
      repoFullName: "webrenew/credit-renew",
      accountType: "Organization" as const,
    },
    repoRows: [
      {
        id: "repo-1",
        user_id: "user-1",
        github_installation_id: 117860437,
      },
    ],
    sync: {} as never,
  };
}

function buildCheckRunRetryContext() {
  return {
    run: {
      id: "job-1",
      flow_id: "flow-1",
      flow_version_id: "version-1",
    },
    userId: "user-1",
    sourceType: "pr_opened",
    assignmentId: null,
    triggerId: null,
    flowId: "flow-1",
    flowVersionId: "version-1",
    repoId: "repo-1",
    installationId: 117860437,
    metadata: null,
  } as never;
}

test("check-run rerun redelivery reuses its job and retries a missed start", async () => {
  const { buildCheckRunRetryResponse } = await loadGithubWebhookRoute();
  const idempotencyKeys: string[] = [];
  const startedJobIds: string[] = [];
  let enqueueCall = 0;
  let startCall = 0;
  const input = buildCheckRunRetryResponseInput();
  const deps = {
    loadJobRunRetryContext: async () => buildCheckRunRetryContext(),
    enqueueJobRunRetry: async (enqueueInput: { idempotencyKey?: string }) => {
      enqueueCall += 1;
      idempotencyKeys.push(enqueueInput.idempotencyKey ?? "");
      return enqueueCall === 1
        ? { jobRunId: "job-2", outcome: "queued" as const, reason: null }
        : {
            jobRunId: "job-2",
            outcome: "suppressed" as const,
            reason: "IDEMPOTENT_DUPLICATE",
          };
    },
    startWebhookJobRun: async (jobRunId: string) => {
      startCall += 1;
      startedJobIds.push(jobRunId);
      return startCall === 1
        ? {
            started: false,
            deferred: false,
            runtimeProvider: null,
            runtimeRunId: null,
            workflowRunId: null,
            status: "pending",
            reason: null,
            error: "transient dispatch failure",
          }
        : {
            started: true,
            deferred: false,
            runtimeProvider: "trigger",
            runtimeRunId: "trigger-run-2",
            workflowRunId: null,
            status: "pending",
            reason: null,
            error: null,
          };
    },
  };

  await buildCheckRunRetryResponse(input, deps as never);
  const redeliveryResponse = await buildCheckRunRetryResponse(
    input,
    deps as never
  );
  const redelivery = await redeliveryResponse!.json();

  assert.deepEqual(idempotencyKeys, [
    "github-webhook:check-run-rerun:91:delivery-rerun-1",
    "github-webhook:check-run-rerun:91:delivery-rerun-1",
  ]);
  assert.deepEqual(startedJobIds, ["job-2", "job-2"]);
  assert.equal(redelivery.queued, false);
  assert.equal(redelivery.suppressed, true);
  assert.equal(redelivery.reused, true);
  assert.equal(redelivery.started, true);
});

test("check-run rerun falls back to the original version when latest is unavailable", async () => {
  const { buildCheckRunRetryResponse } = await loadGithubWebhookRoute();
  const { JobRunRetryVersionError } = await import("../../lib/job-run-retry");
  const enqueueInputs: Array<{
    versionMode: string;
    idempotencyKey: string | undefined;
    metadataPatch: Record<string, unknown> | undefined;
  }> = [];

  const response = await buildCheckRunRetryResponse(
    buildCheckRunRetryResponseInput(),
    {
      loadJobRunRetryContext: async () => buildCheckRunRetryContext(),
      enqueueJobRunRetry: async (input) => {
        enqueueInputs.push({
          versionMode: input.versionMode,
          idempotencyKey: input.idempotencyKey,
          metadataPatch: input.metadataPatch,
        });
        if (input.versionMode === "latest_published") {
          throw new JobRunRetryVersionError();
        }
        return { jobRunId: "job-2", outcome: "queued", reason: null };
      },
      startWebhookJobRun: async () => ({
        started: true,
        deferred: false,
        runtimeProvider: "trigger",
        runtimeRunId: "trigger-run-2",
        workflowRunId: null,
        status: "pending",
        reason: null,
        error: null,
      }),
    }
  );
  const body = await response!.json();

  assert.deepEqual(
    enqueueInputs.map((input) => input.versionMode),
    ["latest_published", "same_version"]
  );
  assert.equal(
    enqueueInputs[0]?.idempotencyKey,
    enqueueInputs[1]?.idempotencyKey
  );
  assert.equal(
    enqueueInputs[1]?.metadataPatch?.retry_latest_published_unavailable,
    true
  );
  assert.equal(body.versionFallbackUsed, true);
  assert.equal(body.started, true);
});

test("startWebhookJobRun catches start failures and returns a non-throwing payload", async () => {
  const { startWebhookJobRun } = await loadGithubWebhookRoute();
  const originalConsoleError = console.error;

  console.error = () => {};

  try {
    const started = await startWebhookJobRun(
      "job-123",
      "manual_retry",
      async () => {
        throw new Error("transient start failure");
      }
    );

    assert.deepEqual(started, {
      started: false,
      deferred: false,
      runtimeProvider: null,
      runtimeRunId: null,
      workflowRunId: null,
      status: "pending",
      reason: null,
      error: "transient start failure",
    });
  } finally {
    console.error = originalConsoleError;
  }
});

test("POST rejects invalid signatures before parsing malformed payloads when a global secret is configured", async () => {
  const { POST } = await loadGithubWebhookRoute();
  const previousSecret = process.env.GITHUB_WEBHOOK_SECRET;
  process.env.GITHUB_WEBHOOK_SECRET = "test-secret";

  try {
    const response = await POST(
      new Request("http://localhost/api/webhooks/github", {
        method: "POST",
        headers: {
          "x-github-event": "push",
          "x-github-delivery": crypto.randomUUID(),
          "x-hub-signature-256": "sha256=invalid",
          "content-type": "application/json",
        },
        body: "{",
      })
    );

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "Invalid signature" });
  } finally {
    if (previousSecret === undefined) {
      delete process.env.GITHUB_WEBHOOK_SECRET;
    } else {
      process.env.GITHUB_WEBHOOK_SECRET = previousSecret;
    }
  }
});

test("tryResumeFlowWaitsForLabeledEvent skips non-labeled events", async () => {
  const { tryResumeFlowWaitsForLabeledEvent } = await loadGithubWebhookRoute();

  const result = await tryResumeFlowWaitsForLabeledEvent({
    context: {
      event: "push",
      deliveryId: "d-1",
      signature: "",
      globalSecret: null,
      payload: "{}",
      body: { action: "labeled" },
      installationId: 99,
      repoGithubId: null,
      repoFullName: null,
      accountType: "User",
    },
    repoRows: [],
  });
  assert.equal(result, null);
});

test("tryResumeFlowWaitsForLabeledEvent skips labeled events without a label name", async () => {
  const { tryResumeFlowWaitsForLabeledEvent } = await loadGithubWebhookRoute();
  const result = await tryResumeFlowWaitsForLabeledEvent({
    context: {
      event: "pull_request",
      deliveryId: "d-2",
      signature: "",
      globalSecret: null,
      payload: "{}",
      body: { action: "labeled", label: null },
      installationId: 99,
      repoGithubId: null,
      repoFullName: null,
      accountType: "User",
    },
    repoRows: [],
  });
  assert.equal(result, null);
});

test("tryResumeFlowWaitsForLabeledEvent routes a pull_request labeled event with no candidates to a zero-match outcome", async () => {
  const { tryResumeFlowWaitsForLabeledEvent } = await loadGithubWebhookRoute();
  const originalFetch = globalThis.fetch;
  // The wait-service module loads the Supabase admin client at call time. To
  // keep this test from making real network calls, intercept the GET on
  // flow_waits and return zero candidates. With zero candidates, the routing
  // helper short-circuits before reaching the resume CAS or wait token call.
  globalThis.fetch = async (input: unknown, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.includes("/rest/v1/flow_waits") && method === "GET") {
      return Response.json([]);
    }
    throw new Error(`Unexpected fetch in test: ${method} ${url}`);
  };
  try {
    const result = await tryResumeFlowWaitsForLabeledEvent({
      context: {
        event: "pull_request",
        deliveryId: "d-3",
        signature: "",
        globalSecret: null,
        payload: "{}",
        body: {
          action: "labeled",
          label: { name: "ready-to-merge" },
          pull_request: { number: 42 },
        },
        installationId: 99,
        repoGithubId: 12345,
        repoFullName: "acme/widgets",
        accountType: "User",
      },
      repoRows: [
        {
          id: "repo-1",
          user_id: "user-1",
          full_name: "acme/widgets",
          github_installation_id: 99,
          root_directory: null,
          parent_repo_id: null,
        },
      ],
    });
    assert.ok(result);
    assert.equal(result?.matched, 0);
    assert.equal(result?.resumed, 0);
    assert.equal(result?.alreadyResumed, 0);
    assert.equal(result?.completeFailed, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("tryResumeFlowWaitsForGithubEvent routes completed CI events", async () => {
  const { tryResumeFlowWaitsForGithubEvent } = await loadGithubWebhookRoute();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: unknown, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.includes("/rest/v1/flow_waits") && method === "GET") {
      assert.match(url, /wait_kind=eq\.ci_workflow_completed/);
      return Response.json([]);
    }
    throw new Error(`Unexpected fetch in test: ${method} ${url}`);
  };

  try {
    const result = await tryResumeFlowWaitsForGithubEvent({
      context: {
        event: "workflow_run",
        deliveryId: "delivery-ci",
        signature: "",
        globalSecret: null,
        payload: "{}",
        body: {
          action: "completed",
          workflow_run: {
            name: "CI / test",
            conclusion: "success",
            head_sha: "abc123",
          },
        },
        installationId: 99,
        repoGithubId: 12345,
        repoFullName: "acme/widgets",
        accountType: "Organization",
      },
      repoRows: [
        {
          id: "repo-1",
          user_id: "user-1",
          full_name: "acme/widgets",
          github_installation_id: 99,
          root_directory: null,
          parent_repo_id: null,
        },
      ],
    });

    assert.deepEqual(result, {
      matched: 0,
      resumed: 0,
      alreadyResumed: 0,
      completeFailed: 0,
      failures: [],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("tryResumeFlowWaitsForGithubEvent routes new GitHub comments and ignores Mogplex output", async () => {
  const { tryResumeFlowWaitsForGithubEvent } = await loadGithubWebhookRoute();
  const originalFetch = globalThis.fetch;
  let waitQueries = 0;
  globalThis.fetch = async (input: unknown, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.includes("/rest/v1/flow_waits") && method === "GET") {
      waitQueries += 1;
      assert.match(url, /wait_kind=eq\.github_comment_added/);
      return Response.json([]);
    }
    throw new Error(`Unexpected fetch in test: ${method} ${url}`);
  };

  const context = {
    event: "issue_comment",
    deliveryId: "delivery-comment",
    signature: "",
    globalSecret: null,
    payload: "{}",
    body: {
      action: "created",
      issue: { number: 42, pull_request: { url: "https://api.github.test" } },
      comment: {
        body: "Approved",
        user: { login: "alice", type: "User" },
      },
    },
    installationId: 99,
    repoGithubId: 12345,
    repoFullName: "acme/widgets",
    accountType: "Organization" as const,
  };
  const repoRows = [
    {
      id: "repo-1",
      user_id: "user-1",
      full_name: "acme/widgets",
      github_installation_id: 99,
      root_directory: null,
      parent_repo_id: null,
    },
  ];

  try {
    const result = await tryResumeFlowWaitsForGithubEvent({
      context,
      repoRows,
    });
    assert.deepEqual(result, {
      matched: 0,
      resumed: 0,
      alreadyResumed: 0,
      completeFailed: 0,
      failures: [],
    });
    assert.equal(waitQueries, 1);

    const ignored = await tryResumeFlowWaitsForGithubEvent({
      context: {
        ...context,
        body: {
          ...context.body,
          comment: {
            body: "Automated response\n\n<!-- mogplex:automated -->",
            user: { login: "connected-user", type: "User" },
          },
        },
      },
      repoRows,
    });
    assert.equal(ignored, null);
    assert.equal(waitQueries, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Vercel preview waits only accept successful Vercel deployment statuses", async () => {
  const { isVercelDeploymentStatus, tryResumeFlowWaitsForGithubEvent } =
    await loadGithubWebhookRoute();
  const vercelBody = {
    deployment: {
      sha: "abc123",
      environment: "Preview",
      creator: { login: "vercel[bot]" },
    },
    deployment_status: {
      state: "success",
      environment: "Preview",
      environment_url: "https://acme-git-branch.vercel.app",
    },
  };
  assert.equal(isVercelDeploymentStatus(vercelBody), true);
  assert.equal(
    isVercelDeploymentStatus({
      deployment: { creator: { login: "other-bot" } },
      deployment_status: {
        environment_url: "https://preview.example.com",
      },
    }),
    false
  );

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: unknown, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.includes("/rest/v1/flow_waits") && method === "GET") {
      assert.match(url, /wait_kind=eq\.vercel_preview_ready/);
      return Response.json([]);
    }
    throw new Error(`Unexpected fetch in test: ${method} ${url}`);
  };

  try {
    const result = await tryResumeFlowWaitsForGithubEvent({
      context: {
        event: "deployment_status",
        deliveryId: "delivery-preview",
        signature: "",
        globalSecret: null,
        payload: "{}",
        body: vercelBody,
        installationId: 99,
        repoGithubId: 12345,
        repoFullName: "acme/widgets",
        accountType: "Organization",
      },
      repoRows: [
        {
          id: "repo-1",
          user_id: "user-1",
          full_name: "acme/widgets",
          github_installation_id: 99,
          root_directory: null,
          parent_repo_id: null,
        },
      ],
    });
    assert.equal(result?.matched, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function buildLabeledFlowGraph(startData: Record<string, unknown>) {
  return {
    nodes: [
      {
        id: "start",
        type: "start",
        position: { x: 0, y: 0 },
        data: { label: "Label added", event: "labeled", ...startData },
      },
      {
        id: "agent-1",
        type: "agent",
        position: { x: 100, y: 0 },
        data: { label: "Reviewer", agentId: "agent-1" },
      },
      {
        id: "end",
        type: "end",
        position: { x: 200, y: 0 },
        data: { label: "Done" },
      },
    ],
    edges: [
      { id: "start-agent", source: "start", target: "agent-1" },
      { id: "agent-end", source: "agent-1", target: "end" },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

function buildLabeledFlowInput(
  startData: Record<string, unknown>,
  result: {
    assignmentType: string;
    triggerEvent: TriggerEvent;
    metadata: Record<string, unknown>;
  }
) {
  return {
    flows: [
      {
        id: "flow-labeled",
        user_id: "user-a",
        installation_id: 117860437,
        published_version_id: "version-labeled",
        published_version: {
          id: "version-labeled",
          graph: buildLabeledFlowGraph(startData),
        },
      },
    ],
    results: [result],
    repoRows: [
      {
        id: "repo-user-a",
        user_id: "user-a",
        full_name: "webrenew/mogplex-tui",
        root_directory: null,
        parent_repo_id: null,
      },
    ],
    payload: '{"action":"labeled"}',
    deliveryId: "delivery-labeled",
    repoFullName: "webrenew/mogplex-tui",
    agentSlugsById: new Map([["agent-1", "reviewer"]]),
  };
}

test("handlePullRequest emits a labeled trigger result with PR and label metadata", async () => {
  const { handlePullRequest } = await loadGithubWebhookRoute();

  const results = handlePullRequest({
    action: "labeled",
    label: { name: "ready-for-review" },
    sender: { login: "octocat", type: "User" },
    pull_request: {
      number: 42,
      html_url: "https://github.com/acme/widgets/pull/42",
      title: "Add widgets",
      draft: true,
      user: { login: "octocat", type: "User" },
      head: {
        ref: "feature",
        sha: "headsha",
        repo: { full_name: "acme/widgets" },
      },
      base: {
        ref: "main",
        sha: "basesha",
        repo: { full_name: "acme/widgets" },
      },
    },
  });

  assert.equal(results.length, 1);
  const result = results[0];
  assert.equal(result?.assignmentType, "labeled");
  assert.equal(result?.triggerEvent, "labeled");
  assert.equal(result?.metadata.label_name, "ready-for-review");
  assert.equal(result?.metadata.sender_login, "octocat");
  assert.equal(result?.metadata.pr_number, 42);
  assert.equal(result?.metadata.issue_number, 42);
  assert.equal(result?.metadata.is_pr, true);
  assert.equal(result?.metadata.head_ref, "feature");
});

test("handleLabeledAction skips our own bot sender but emits issue label results", async () => {
  const { handleLabeledAction } = await loadGithubWebhookRoute();

  const botResults = handleLabeledAction(
    {
      action: "labeled",
      label: { name: "triaged" },
      sender: { login: "mogplex[bot]", type: "Bot" },
      issue: {
        number: 7,
        html_url: "https://github.com/acme/widgets/issues/7",
        title: "Bug report",
      },
    },
    false
  );
  assert.equal(botResults.length, 0);

  const results = handleLabeledAction(
    {
      action: "labeled",
      label: { name: "triaged" },
      sender: { login: "dependabot[bot]", type: "Bot" },
      issue: {
        number: 7,
        html_url: "https://github.com/acme/widgets/issues/7",
        title: "Bug report",
      },
    },
    false
  );
  assert.equal(results.length, 1);
  assert.equal(results[0]?.metadata.is_pr, false);
  assert.equal(results[0]?.metadata.issue_number, 7);
  assert.equal(results[0]?.metadata.label_name, "triaged");
  assert.equal(results[0]?.authorIsBot, true);
});

test("buildFlowWebhookJobs matches labeled flows on the exact label name", async () => {
  const { buildFlowWebhookJobs } = await loadGithubWebhookRoute();

  const labeledResult = {
    assignmentType: "labeled",
    triggerEvent: "labeled" as const,
    metadata: {
      issue_number: 42,
      is_pr: true,
      label_name: "ready-for-review",
    },
  };

  const matching = buildFlowWebhookJobs(
    buildLabeledFlowInput({ labelName: "ready-for-review" }, labeledResult)
  );
  assert.equal(matching.length, 1);
  assert.equal(matching[0]?.scope.sourceType, "labeled");
  assert.equal(matching[0]?.metadata.label_name, "ready-for-review");

  const mismatched = buildFlowWebhookJobs(
    buildLabeledFlowInput({ labelName: "needs-triage" }, labeledResult)
  );
  assert.equal(mismatched.length, 0);

  const anyLabel = buildFlowWebhookJobs(
    buildLabeledFlowInput({}, labeledResult)
  );
  assert.equal(anyLabel.length, 1);
});

test("buildFlowWebhookJobs honors labelPrOnly on labeled flows", async () => {
  const { buildFlowWebhookJobs } = await loadGithubWebhookRoute();

  const issueLabelResult = {
    assignmentType: "labeled",
    triggerEvent: "labeled" as const,
    metadata: {
      issue_number: 7,
      is_pr: false,
      label_name: "ready-for-review",
    },
  };

  const prOnlyJobs = buildFlowWebhookJobs(
    buildLabeledFlowInput(
      { labelName: "ready-for-review", labelPrOnly: true },
      issueLabelResult
    )
  );
  assert.equal(prOnlyJobs.length, 0);

  const anyTargetJobs = buildFlowWebhookJobs(
    buildLabeledFlowInput({ labelName: "ready-for-review" }, issueLabelResult)
  );
  assert.equal(anyTargetJobs.length, 1);
});

test("handleTagPush emits a tag_push result and skips deletions and our own bot", async () => {
  const { handleTagPush } = await loadGithubWebhookRoute();

  const results = handleTagPush(
    {
      ref: "refs/tags/v1.2.3",
      after: "tagsha",
      head_commit: { id: "commitsha" },
      compare: "https://github.com/acme/widgets/compare/v1.2.2...v1.2.3",
      sender: { login: "octocat", type: "User" },
    },
    "refs/tags/v1.2.3"
  );
  assert.equal(results.length, 1);
  assert.equal(results[0]?.assignmentType, "tag_push");
  assert.equal(results[0]?.triggerEvent, "tag_push");
  assert.equal(results[0]?.metadata.tag_name, "v1.2.3");
  assert.equal(results[0]?.metadata.head_sha, "commitsha");
  assert.equal(results[0]?.metadata.sender_login, "octocat");

  const deleted = handleTagPush(
    {
      ref: "refs/tags/v1.2.3",
      deleted: true,
      sender: { login: "octocat", type: "User" },
    },
    "refs/tags/v1.2.3"
  );
  assert.equal(deleted.length, 0);

  const bot = handleTagPush(
    {
      ref: "refs/tags/v1.2.3",
      sender: { login: "mogplex[bot]", type: "Bot" },
    },
    "refs/tags/v1.2.3"
  );
  assert.equal(bot.length, 0);
});

test("doesTagMatchPattern applies minimal glob semantics", async () => {
  const { doesTagMatchPattern } = await loadGithubWebhookRoute();

  assert.equal(doesTagMatchPattern("", "v1.2.3"), true);
  assert.equal(doesTagMatchPattern("   ", "v1.2.3"), true);
  assert.equal(doesTagMatchPattern("v*", "v1.2.3"), true);
  assert.equal(doesTagMatchPattern("v*", "release-1"), false);
  assert.equal(doesTagMatchPattern("v1.2.3", "v1.2.3"), true);
  assert.equal(doesTagMatchPattern("v1.2.3", "v1.243"), false);
  assert.equal(doesTagMatchPattern("release-*-rc", "release-2026-rc"), true);
  assert.equal(
    doesTagMatchPattern("release-*-rc", "release-2026-final"),
    false
  );
});

test("buildFlowWebhookJobs matches tag_push flows on the tag pattern", async () => {
  const { buildFlowWebhookJobs } = await loadGithubWebhookRoute();

  const tagResult = {
    assignmentType: "tag_push",
    triggerEvent: "tag_push" as const,
    metadata: {
      tag_name: "v2.0.0",
      head_sha: "commitsha",
    },
  };

  const makeInput = (startData: Record<string, unknown>) => ({
    flows: [
      {
        id: "flow-tag",
        user_id: "user-a",
        installation_id: 117860437,
        published_version_id: "version-tag",
        published_version: {
          id: "version-tag",
          graph: {
            nodes: [
              {
                id: "start",
                type: "start",
                position: { x: 0, y: 0 },
                data: { label: "Tag pushed", event: "tag_push", ...startData },
              },
              {
                id: "agent-1",
                type: "agent",
                position: { x: 100, y: 0 },
                data: { label: "Reviewer", agentId: "agent-1" },
              },
              {
                id: "end",
                type: "end",
                position: { x: 200, y: 0 },
                data: { label: "Done" },
              },
            ],
            edges: [
              { id: "start-agent", source: "start", target: "agent-1" },
              { id: "agent-end", source: "agent-1", target: "end" },
            ],
            viewport: { x: 0, y: 0, zoom: 1 },
          },
        },
      },
    ],
    results: [tagResult],
    repoRows: [
      {
        id: "repo-user-a",
        user_id: "user-a",
        full_name: "webrenew/mogplex-tui",
        root_directory: null,
        parent_repo_id: null,
      },
    ],
    payload: '{"ref":"refs/tags/v2.0.0"}',
    deliveryId: "delivery-tag",
    repoFullName: "webrenew/mogplex-tui",
    agentSlugsById: new Map([["agent-1", "reviewer"]]),
  });

  assert.equal(buildFlowWebhookJobs(makeInput({ tagPattern: "v*" })).length, 1);
  assert.equal(buildFlowWebhookJobs(makeInput({})).length, 1);
  assert.equal(
    buildFlowWebhookJobs(makeInput({ tagPattern: "release-*" })).length,
    0
  );
});

test("handleCIEvent carries the failing branch through check_run and workflow_run metadata", async () => {
  const { handleCIEvent } = await loadGithubWebhookRoute();

  const checkResults = handleCIEvent("check_run", {
    action: "completed",
    check_run: {
      conclusion: "failure",
      name: "build",
      head_sha: "abc123",
      details_url: "https://github.com/acme/widgets/runs/1",
      check_suite: { head_branch: "release/2.x" },
    },
  });
  assert.equal(checkResults.length, 1);
  assert.equal(checkResults[0]?.metadata.head_branch, "release/2.x");

  const workflowResults = handleCIEvent("workflow_run", {
    action: "completed",
    workflow_run: {
      conclusion: "failure",
      name: "CI",
      head_sha: "abc123",
      html_url: "https://github.com/acme/widgets/actions/runs/7",
      id: 7,
      head_branch: "release/2.x",
    },
  });
  assert.equal(workflowResults.length, 1);
  assert.equal(workflowResults[0]?.metadata.head_branch, "release/2.x");

  // Payloads without a branch must degrade to null, never to a wrong branch.
  const noBranch = handleCIEvent("check_run", {
    action: "completed",
    check_run: {
      conclusion: "failure",
      name: "build",
      head_sha: "abc123",
      details_url: "https://github.com/acme/widgets/runs/2",
    },
  });
  assert.equal(noBranch[0]?.metadata.head_branch, null);
});
