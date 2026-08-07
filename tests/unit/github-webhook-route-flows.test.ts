import assert from "node:assert/strict";
import test from "node:test";
import { loadGithubWebhookRoute } from "./helpers/github-webhook-route-fixtures";

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
