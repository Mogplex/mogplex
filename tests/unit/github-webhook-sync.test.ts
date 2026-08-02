import assert from "node:assert/strict";
import test from "node:test";
import { planGithubWebhookSync } from "../../lib/github-webhook-sync";

test("plans installation repository additions and removals", () => {
  const plan = planGithubWebhookSync("installation_repositories", {
    action: "added",
    sender: { login: "charles" },
    installation: {
      id: 123,
      account: { login: "webrenew", type: "Organization" },
      target_type: "Organization",
      permissions: { contents: "read" },
    },
    repositories_added: [
      { id: 1, full_name: "webrenew/mogplex", default_branch: "main" },
    ],
    repositories_removed: [{ id: 2 }],
  });

  assert.equal(plan.type, "installation_repositories");
  if (plan.type !== "installation_repositories") return;
  assert.equal(plan.installationId, 123);
  assert.equal(plan.senderLogin, "charles");
  assert.equal(plan.accountLogin, "webrenew");
  assert.equal(plan.addedRepos.length, 1);
  assert.deepEqual(plan.removedRepoIds, [2]);
});

test("plans repository lifecycle sync for installation-scoped events", () => {
  const plan = planGithubWebhookSync("repository", {
    action: "created",
    sender: { login: "charles" },
    installation: {
      id: 456,
      account: { login: "webrenew", type: "Organization" },
      target_type: "Organization",
    },
    repository: {
      id: 99,
      full_name: "webrenew/new-repo",
      default_branch: "main",
      owner: { login: "webrenew" },
      name: "new-repo",
    },
  });

  assert.equal(plan.type, "repository");
  if (plan.type !== "repository") return;
  assert.equal(plan.installationId, 456);
  assert.equal(plan.repo.full_name, "webrenew/new-repo");
});

test("ignores non-installation GitHub events for sync planning", () => {
  const plan = planGithubWebhookSync("pull_request", {
    action: "opened",
    installation: { id: 789 },
  });

  assert.deepEqual(plan, { type: "none" });
});
