import assert from "node:assert/strict";
import test from "node:test";
import {
  loadGithubWebhookRoute,
  buildLabeledFlowInput,
} from "./helpers/github-webhook-route-fixtures";

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
