import assert from "node:assert/strict";
import test from "node:test";
import {
  loadGithubWebhookRoute,
  captureDualReadLogs,
  buildPrOpenedFlowFixture,
  PR_OPENED_RESULT,
  REPO_FIXTURE,
} from "./helpers/github-webhook-route-fixtures";

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
