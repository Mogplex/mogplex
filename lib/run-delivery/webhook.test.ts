import { expect, test } from "vitest";
import { refreshDeliveryForGithubEvent } from "./webhook";
import { deliveryRun, deliverySnapshot } from "./fixtures.test-support";

function fixture() {
  const run = deliveryRun();
  run.metadata.delivery_progress = deliverySnapshot();
  const refreshed: string[] = [];
  const input = {
    event: "check_run",
    body: { check_run: { head_sha: "head-1" } },
    repos: [
      { id: run.repo_id, user_id: run.user_id, full_name: run.repo_full_name },
    ],
  };
  const deps = {
    list: async () => [run],
    refresh: async (value: typeof run, repair = false) => {
      expect(repair).toBe(true);
      refreshed.push(value.id);
      return deliverySnapshot();
    },
  };
  return { run, input, deps, refreshed };
}
test("verified GitHub events refresh only the resolved owner's matching branch or commit", async () => {
  const f = fixture();
  await refreshDeliveryForGithubEvent(f.input, f.deps);
  expect(f.refreshed).toEqual([f.run.id]);
  f.refreshed.length = 0;
  for (const input of [
    { ...f.input, event: "issues" },
    { ...f.input, body: { check_run: { head_sha: "unrelated" } } },
    { ...f.input, repos: [{ ...f.input.repos[0], id: "foreign-repository" }] },
    {
      ...f.input,
      body: {
        pull_request: {
          head: {
            ref: f.run.working_branch,
            sha: "head-2",
            repo: { full_name: "foreign/widgets" },
          },
        },
      },
    },
    { ...f.input, body: { check_run: { head_sha: 123 } } },
  ])
    await refreshDeliveryForGithubEvent(input, f.deps);
  expect(f.refreshed).toEqual([]);
});
test("review, new-head workflow and exact-merge deployment events trigger fresh verification", async () => {
  const f = fixture();
  const snapshot = deliverySnapshot();
  snapshot.pullRequest!.mergeSha = "merge-1";
  f.run.metadata.delivery_progress = snapshot;
  for (const [event, body] of [
    [
      "pull_request_review",
      {
        pull_request: {
          head: {
            ref: f.run.working_branch,
            sha: "head-2",
            repo: { full_name: f.run.repo_full_name },
          },
        },
      },
    ],
    [
      "workflow_run",
      {
        workflow_run: { head_sha: "head-2", head_branch: f.run.working_branch },
      },
    ],
    ["deployment_status", { deployment: { sha: "merge-1", ref: "main" } }],
  ] as const)
    await refreshDeliveryForGithubEvent({ ...f.input, event, body }, f.deps);
  expect(f.refreshed).toHaveLength(3);
});
test("failed refreshes propagate for durable webhook retry", async () => {
  const f = fixture();
  await expect(
    refreshDeliveryForGithubEvent(f.input, {
      ...f.deps,
      refresh: async () => {
        throw new Error("provider unavailable");
      },
    })
  ).rejects.toThrow("Could not refresh run delivery");
});

test("authorized team-member runs follow the verified repository even when its owner differs", async () => {
  const f = fixture();
  f.input.repos[0].user_id = "team-repository-owner";
  await refreshDeliveryForGithubEvent(f.input, f.deps);
  expect(f.refreshed).toEqual([f.run.id]);
});

test("a base-branch deployment does not fan out to unrelated historical runs", async () => {
  const f = fixture();
  await refreshDeliveryForGithubEvent(
    {
      ...f.input,
      event: "deployment_status",
      body: { deployment: { sha: "unrelated-merge", ref: "main" } },
    },
    f.deps
  );
  expect(f.refreshed).toEqual([]);
});
