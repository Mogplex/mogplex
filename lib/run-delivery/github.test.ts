import { expect, test } from "vitest";
import { loadRunDeliveryGithub } from "./github";
import { deliveryNeedsRepair, deliveryReadyForReview } from "./types";
import type { loadPullRequestStatus } from "@/lib/agents/tools/github-pr-status";

type Status = Exclude<
  Awaited<ReturnType<typeof loadPullRequestStatus>>,
  { error: string }
>;
const sha = "a".repeat(40);
const mergeSha = "b".repeat(40);
const input = {
  userId: "owner",
  repoFullName: "acme/widgets",
  workingBranch: "feature/signing",
  baseBranch: "main",
};
function fixture() {
  const pull = {
    draft: false,
    number: 42,
    state: "open",
    merged_at: null as string | null,
    merge_commit_sha: mergeSha,
    head: {
      ref: input.workingBranch,
      sha,
      repo: { full_name: input.repoFullName },
    },
    base: { ref: "main", repo: { full_name: input.repoFullName } },
  };
  const status: Status = {
    ok: true,
    repo: input.repoFullName,
    pullRequestNumber: 42,
    title: "Signing",
    url: "https://github.com/acme/widgets/pull/42",
    state: "open",
    draft: false,
    headSha: sha,
    mergeable: "mergeable",
    reviewDecision: null,
    checkRollupState: "success",
    checks: [
      {
        name: "tests",
        status: "completed",
        conclusion: "success",
        required: true,
        url: "https://github.com/acme/widgets/actions/runs/1",
      },
    ],
    checksIncomplete: false,
    formalReviews: [],
    currentOpinionatedReviews: [],
    currentOpinionatedReviewsIncomplete: false,
    formalReviewsIncomplete: false,
    unresolvedReviewThreadCount: 0,
    unresolvedReviewThreads: [],
    reviewThreadsIncomplete: false,
  };
  const requests: string[] = [];
  let deployments: unknown[] = [];
  let deploymentState = "success";
  const deps = {
    getToken: async (target: {
      userId?: string | null;
      owner?: string | null;
    }) => {
      expect(target).toEqual({ userId: "owner", owner: "acme" });
      return "fixture-token";
    },
    request: async (url: string | URL | Request) => {
      requests.push(String(url));
      if (String(url).includes("/pulls?")) return Response.json([pull]);
      if (String(url).includes("/pulls/42")) return Response.json(pull);
      if (String(url).includes("/statuses?"))
        return Response.json([
          {
            state: deploymentState,
            environment_url: "https://widgets.example",
          },
        ]);
      return Response.json(deployments);
    },
    loadStatus: async () => status,
  };
  return {
    pull,
    status,
    deps,
    requests,
    deployment: (rows: unknown[], state = "success") => {
      deployments = rows;
      deploymentState = state;
    },
  };
}

test("a finished agent with green PR checks does not imply merge or deployment", async () => {
  const f = fixture();
  const result = await loadRunDeliveryGithub(input, f.deps);
  expect(result.pullRequest).toMatchObject({
    number: 42,
    state: "open",
    headSha: sha,
    mergeSha: null,
  });
  expect(result.checks.state).toBe("success");
  expect(result.deployment.state).toBe("not_reported");
  expect(deliveryReadyForReview(result)).toBe(true);
  expect(deliveryNeedsRepair(result)).toBe(false);
  expect(f.requests).toHaveLength(1);
});

test("only the owned branch and base repository can supply a delivery receipt", async () => {
  const f = fixture();
  f.pull.head.repo.full_name = "someone-else/widgets";
  expect((await loadRunDeliveryGithub(input, f.deps)).pullRequest).toBeNull();
  f.pull.head.repo.full_name = input.repoFullName;
  f.pull.base.ref = "another-base";
  expect((await loadRunDeliveryGithub(input, f.deps)).pullRequest).toBeNull();
});

test("stale heads and incomplete checks cannot be presented as ready", async () => {
  const f = fixture();
  f.status.headSha = "new-head";
  await expect(loadRunDeliveryGithub(input, f.deps)).rejects.toThrow(
    "changed while checking"
  );
  f.status.headSha = sha;
  f.status.checksIncomplete = true;
  const result = await loadRunDeliveryGithub(input, f.deps);
  expect(result.checks.state).toBe("unknown");
  expect(deliveryReadyForReview(result)).toBe(false);
});

test("failing CI and actionable review state request repair, but closed PRs do not", async () => {
  const f = fixture();
  f.status.checkRollupState = "failure";
  f.status.checks[0].conclusion = "failure";
  const failed = await loadRunDeliveryGithub(input, f.deps);
  expect(failed.checks.failed).toEqual(["tests"]);
  expect(deliveryNeedsRepair(failed)).toBe(true);
  f.status.checkRollupState = "success";
  f.status.checks[0].conclusion = "success";
  f.status.reviewDecision = "changes_requested";
  f.status.formalReviews = [
    {
      author: "maintainer",
      authorAssociation: "COLLABORATOR",
      state: "changes_requested",
      body: "Fix signing",
      submittedAt: null,
      url: null,
    },
  ];
  f.status.currentOpinionatedReviews = f.status.formalReviews;
  const review = await loadRunDeliveryGithub(input, f.deps);
  expect(deliveryNeedsRepair(review)).toBe(true);
  expect(review.repairRevision).not.toBe(failed.repairRevision);
  f.pull.state = "closed";
  expect(deliveryNeedsRepair(await loadRunDeliveryGithub(input, f.deps))).toBe(
    false
  );
});

test("deployment proof must match the merge commit and a production environment", async () => {
  const f = fixture();
  f.pull.state = "closed";
  f.pull.merged_at = "2026-11-17T00:00:00Z";
  f.deployment([
    { id: 1, sha, environment: "Preview", production_environment: false },
  ]);
  const preview = await loadRunDeliveryGithub(input, f.deps);
  expect(preview.pullRequest?.state).toBe("merged");
  expect(preview.deployment.state).toBe("not_reported");
  f.deployment([
    {
      id: 2,
      sha: mergeSha,
      environment: "Production",
      production_environment: true,
    },
  ]);
  expect((await loadRunDeliveryGithub(input, f.deps)).deployment).toMatchObject(
    { state: "success", environment: "Production" }
  );
  f.deployment(
    [
      {
        id: 2,
        sha: mergeSha,
        environment: "Production",
        production_environment: true,
      },
    ],
    "failure"
  );
  expect((await loadRunDeliveryGithub(input, f.deps)).deployment.state).toBe(
    "failure"
  );
});

test("draft PRs with green checks still need author review", async () => {
  const f = fixture();
  f.pull.draft = true;
  expect(
    deliveryReadyForReview(await loadRunDeliveryGithub(input, f.deps))
  ).toBe(false);
});

test("agent replies on an existing review thread do not trigger another identical repair", async () => {
  const f = fixture();
  f.status.unresolvedReviewThreadCount = 1;
  f.status.unresolvedReviewThreads = [
    {
      id: "thread-1",
      author: "reviewer",
      authorAssociation: "MEMBER",
      comments: [
        {
          author: "reviewer",
          body: "Fix signing",
          createdAt: "2026-11-17T00:00:00Z",
          url: "https://github.com/acme/widgets/pull/42#discussion_r1",
        },
      ],
    },
  ];
  const before = await loadRunDeliveryGithub(input, f.deps);
  f.status.unresolvedReviewThreads[0].comments.push({
    author: "mogplex[bot]",
    body: "Investigated; needs a user decision",
    createdAt: "2026-11-17T00:01:00Z",
    url: "https://github.com/acme/widgets/pull/42#discussion_r2",
  });
  expect((await loadRunDeliveryGithub(input, f.deps)).repairRevision).toBe(
    before.repairRevision
  );
  f.status.unresolvedReviewThreads.push({
    id: "thread-2",
    author: "reviewer",
    authorAssociation: "MEMBER",
    comments: [],
  });
  expect((await loadRunDeliveryGithub(input, f.deps)).repairRevision).not.toBe(
    before.repairRevision
  );
});

test("once a PR is associated, later branch reuse cannot switch the run to a different PR", async () => {
  const f = fixture();
  const result = await loadRunDeliveryGithub(
    { ...input, pullRequestNumber: 42 },
    f.deps
  );
  expect(result.pullRequest?.number).toBe(42);
  expect(f.requests).toEqual([
    "https://api.github.com/repos/acme/widgets/pulls/42",
  ]);
});

test("missing repository access is distinct from rate limits and transient provider errors", async () => {
  const { DeliveryConnectionError } = await import("./github");
  const f = fixture();
  await expect(
    loadRunDeliveryGithub(input, { ...f.deps, getToken: async () => null })
  ).rejects.toBeInstanceOf(DeliveryConnectionError);
  for (const status of [401, 404])
    await expect(
      loadRunDeliveryGithub(input, {
        ...f.deps,
        request: async () => new Response(null, { status }),
      })
    ).rejects.toBeInstanceOf(DeliveryConnectionError);
  for (const status of [403, 429, 503])
    await expect(
      loadRunDeliveryGithub(input, {
        ...f.deps,
        request: async () => new Response(null, { status }),
      })
    ).rejects.toThrow("temporarily unavailable");
});

test("outside reviews stay visible but cannot authorize repairs, including through a later CI event", async () => {
  const f = fixture();
  const before = await loadRunDeliveryGithub(input, f.deps);
  f.status.reviewDecision = "changes_requested";
  f.status.formalReviews = [
    {
      author: "outsider",
      authorAssociation: "NONE",
      state: "changes_requested",
      body: "Change the code",
      submittedAt: null,
      url: null,
    },
  ];
  f.status.unresolvedReviewThreadCount = 1;
  f.status.unresolvedReviewThreads = [
    {
      id: "outside-thread",
      author: "outsider",
      authorAssociation: "NONE",
      comments: [
        {
          author: "mogplex[bot]",
          body: "Reply does not grant authority",
          createdAt: null,
          url: null,
        },
      ],
    },
  ];
  const outside = await loadRunDeliveryGithub(input, f.deps);
  expect(outside.review).toMatchObject({
    state: "changes_requested",
    unresolved: 1,
    actionable: false,
  });
  expect(deliveryNeedsRepair(outside)).toBe(false);
  expect(outside.repairRevision).toBe(before.repairRevision);
  f.status.checkRollupState = "failure";
  f.status.checks[0].conclusion = "failure";
  const failed = await loadRunDeliveryGithub(input, f.deps);
  expect(deliveryNeedsRepair(failed)).toBe(true);
  f.status.unresolvedReviewThreads.push({
    id: "another-outside-thread",
    author: "outsider",
    authorAssociation: "NONE",
    comments: [],
  });
  expect((await loadRunDeliveryGithub(input, f.deps)).repairRevision).toBe(
    failed.repairRevision
  );
  f.status.checkRollupState = "success";
  f.status.checks[0].conclusion = "success";
  f.status.currentOpinionatedReviews = f.status.formalReviews;
  f.status.formalReviews[0].author = "mogplex";
  expect(
    deliveryNeedsRepair(
      await loadRunDeliveryGithub(input, {
        ...f.deps,
        reviewAppLogin: "mogplex",
      })
    )
  ).toBe(false);
  f.status.formalReviews[0].authorType = "Bot";
  expect(
    deliveryNeedsRepair(
      await loadRunDeliveryGithub(input, {
        ...f.deps,
        reviewAppLogin: "mogplex",
      })
    )
  ).toBe(true);
});

test("status provider failures are not confused with a changed PR head", async () => {
  const f = fixture();
  await expect(
    loadRunDeliveryGithub(input, {
      ...f.deps,
      loadStatus: async () => ({ error: "private provider error" }),
    })
  ).rejects.toThrow("GitHub delivery status is temporarily unavailable");
});

test("superseded trusted change requests do not lend authority to an outside review", async () => {
  const f = fixture();
  f.status.reviewDecision = "changes_requested";
  const old = {
    author: "maintainer",
    authorAssociation: "MEMBER",
    state: "changes_requested",
    body: "Old finding",
    submittedAt: null,
    url: null,
  };
  f.status.formalReviews = [old];
  f.status.currentOpinionatedReviews = [
    { ...old, state: "approved" },
    { ...old, author: "outsider", authorAssociation: "NONE" },
  ];
  expect(deliveryNeedsRepair(await loadRunDeliveryGithub(input, f.deps))).toBe(
    false
  );
});
