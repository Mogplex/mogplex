import assert from "node:assert/strict";
import test from "node:test";

async function loadReviewFindingIssueRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/observability/jobs/[id]/review-findings/[findingId]/issue/route");
}

function makeReviewFinding(
  overrides: Partial<{
    status: "open" | "issue_creating" | "issue_created" | "dismissed";
    issue_number: number | null;
    issue_url: string | null;
    repo_id: string | null;
  }> = {}
) {
  return {
    id: "finding-1",
    user_id: "user-1",
    job_run_id: "job-1",
    repo_id: "repo-1",
    repo_full_name: "acme/widgets",
    pr_number: 42,
    head_sha: "abc123",
    ordinal: 0,
    fingerprint: "fingerprint-1",
    severity: "warning" as const,
    title: "Guard nullable lookup",
    body: "The widget lookup can be null here.",
    path: "src/widget.ts",
    line: 18,
    status: "open" as const,
    issue_number: null,
    issue_url: null,
    dismissed_at: null,
    created_at: "2026-04-12T10:00:05.000Z",
    updated_at: "2026-04-12T10:00:05.000Z",
    ...overrides,
  };
}

test("POST /api/observability/jobs/[id]/review-findings/[findingId]/issue returns 404 for missing findings", async () => {
  const { createReviewFindingIssuePostHandler } =
    await loadReviewFindingIssueRoute();

  const handler = createReviewFindingIssuePostHandler({
    requireUserId: async () => "user-1",
    claimOwnedReviewFindingIssueCreation: async () => ({
      outcome: "not_found",
      finding: null,
    }),
    getOwnedRepoWithGithubAccessToken: async () => {
      throw new Error("repo lookup should not be called");
    },
    createGithubIssue: async () => {
      throw new Error("createGithubIssue should not be called");
    },
    markReviewFindingIssueCreated: async () => {
      throw new Error("markReviewFindingIssueCreated should not be called");
    },
    releaseReviewFindingIssueCreationClaim: async () => {
      throw new Error(
        "releaseReviewFindingIssueCreationClaim should not be called"
      );
    },
  });

  const response = await handler(
    new Request(
      "http://localhost/api/observability/jobs/job-1/review-findings/finding-1/issue",
      {
        method: "POST",
      }
    ) as never,
    {
      params: Promise.resolve({ id: "job-1", findingId: "finding-1" }),
    }
  );

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: "Review finding not found",
  });
});

test("POST /api/observability/jobs/[id]/review-findings/[findingId]/issue returns an existing linked issue without creating a duplicate", async () => {
  const { createReviewFindingIssuePostHandler } =
    await loadReviewFindingIssueRoute();

  const handler = createReviewFindingIssuePostHandler({
    requireUserId: async () => "user-1",
    claimOwnedReviewFindingIssueCreation: async () => ({
      outcome: "linked",
      finding: makeReviewFinding({
        status: "issue_created",
        issue_number: 77,
        issue_url: "https://github.com/acme/widgets/issues/77",
      }),
    }),
    getOwnedRepoWithGithubAccessToken: async () => {
      throw new Error("repo lookup should not be called");
    },
    createGithubIssue: async () => {
      throw new Error("createGithubIssue should not be called");
    },
    markReviewFindingIssueCreated: async () => {
      throw new Error("markReviewFindingIssueCreated should not be called");
    },
    releaseReviewFindingIssueCreationClaim: async () => {
      throw new Error(
        "releaseReviewFindingIssueCreationClaim should not be called"
      );
    },
  });

  const response = await handler(
    new Request(
      "http://localhost/api/observability/jobs/job-1/review-findings/finding-1/issue",
      {
        method: "POST",
      }
    ) as never,
    {
      params: Promise.resolve({ id: "job-1", findingId: "finding-1" }),
    }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    created: false,
    issueNumber: 77,
    issueUrl: "https://github.com/acme/widgets/issues/77",
  });
});

test("POST /api/observability/jobs/[id]/review-findings/[findingId]/issue returns 409 when issue creation is already in progress", async () => {
  const { createReviewFindingIssuePostHandler } =
    await loadReviewFindingIssueRoute();

  const handler = createReviewFindingIssuePostHandler({
    requireUserId: async () => "user-1",
    claimOwnedReviewFindingIssueCreation: async () => ({
      outcome: "busy",
      finding: makeReviewFinding({
        status: "issue_creating",
      }),
    }),
    getOwnedRepoWithGithubAccessToken: async () => {
      throw new Error("repo lookup should not be called");
    },
    createGithubIssue: async () => {
      throw new Error("createGithubIssue should not be called");
    },
    markReviewFindingIssueCreated: async () => {
      throw new Error("markReviewFindingIssueCreated should not be called");
    },
    releaseReviewFindingIssueCreationClaim: async () => {
      throw new Error(
        "releaseReviewFindingIssueCreationClaim should not be called"
      );
    },
  });

  const response = await handler(
    new Request(
      "http://localhost/api/observability/jobs/job-1/review-findings/finding-1/issue",
      {
        method: "POST",
      }
    ) as never,
    {
      params: Promise.resolve({ id: "job-1", findingId: "finding-1" }),
    }
  );

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "Issue creation is already in progress",
  });
});

test("POST /api/observability/jobs/[id]/review-findings/[findingId]/issue creates and links a GitHub issue", async () => {
  const { createReviewFindingIssuePostHandler } =
    await loadReviewFindingIssueRoute();

  let issueInput: {
    githubToken: string;
    repoFullName: string;
    title: string;
    body: string;
    labels?: string[];
  } | null = null;
  let issueLinkInput: {
    findingId: string;
    issueNumber: number;
    issueUrl: string | null;
  } | null = null;
  let releaseCalls = 0;

  const handler = createReviewFindingIssuePostHandler({
    requireUserId: async () => "user-1",
    claimOwnedReviewFindingIssueCreation: async () => ({
      outcome: "claimed",
      finding: makeReviewFinding({
        status: "issue_creating",
      }),
    }),
    getOwnedRepoWithGithubAccessToken: async () => ({
      repo: {
        id: "repo-1",
        user_id: "user-1",
        full_name: "acme/widgets",
        github_installation_id: 123,
      },
      githubToken: "github-token",
    }),
    createGithubIssue: async (input) => {
      issueInput = input;
      return {
        issueNumber: 88,
        issueUrl: "https://github.com/acme/widgets/issues/88",
      };
    },
    markReviewFindingIssueCreated: async (input) => {
      issueLinkInput = input;
    },
    releaseReviewFindingIssueCreationClaim: async () => {
      releaseCalls += 1;
    },
  });

  const response = await handler(
    new Request(
      "http://localhost/api/observability/jobs/job-1/review-findings/finding-1/issue",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          labels: ["tech-debt", " follow-up "],
        }),
      }
    ) as never,
    {
      params: Promise.resolve({ id: "job-1", findingId: "finding-1" }),
    }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    created: true,
    issueNumber: 88,
    issueUrl: "https://github.com/acme/widgets/issues/88",
  });
  assert.deepEqual(issueInput, {
    githubToken: "github-token",
    repoFullName: "acme/widgets",
    title: "[Warning] Guard nullable lookup",
    body: [
      "## Mogplex Review Finding",
      "",
      "**Severity:** Warning",
      "**Pull request:** #42 in acme/widgets",
      "**Location:** src/widget.ts:L18",
      "**Job run:** job-1",
      "",
      "### Guard nullable lookup",
      "",
      "The widget lookup can be null here.",
    ].join("\n"),
    labels: ["tech-debt", "follow-up"],
  });
  assert.deepEqual(issueLinkInput, {
    findingId: "finding-1",
    issueNumber: 88,
    issueUrl: "https://github.com/acme/widgets/issues/88",
  });
  assert.equal(releaseCalls, 0);
});

test("POST /api/observability/jobs/[id]/review-findings/[findingId]/issue releases the claim when GitHub issue creation fails", async () => {
  const { createReviewFindingIssuePostHandler } =
    await loadReviewFindingIssueRoute();

  let releaseCalls = 0;
  let markedIssue = false;

  const handler = createReviewFindingIssuePostHandler({
    requireUserId: async () => "user-1",
    claimOwnedReviewFindingIssueCreation: async () => ({
      outcome: "claimed",
      finding: makeReviewFinding({
        status: "issue_creating",
      }),
    }),
    getOwnedRepoWithGithubAccessToken: async () => ({
      repo: {
        id: "repo-1",
        user_id: "user-1",
        full_name: "acme/widgets",
        github_installation_id: 123,
      },
      githubToken: "github-token",
    }),
    createGithubIssue: async () => {
      throw new Error("GitHub issue create failed");
    },
    markReviewFindingIssueCreated: async () => {
      markedIssue = true;
    },
    releaseReviewFindingIssueCreationClaim: async () => {
      releaseCalls += 1;
    },
  });

  const response = await handler(
    new Request(
      "http://localhost/api/observability/jobs/job-1/review-findings/finding-1/issue",
      {
        method: "POST",
      }
    ) as never,
    {
      params: Promise.resolve({ id: "job-1", findingId: "finding-1" }),
    }
  );

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: "GitHub issue create failed",
  });
  assert.equal(releaseCalls, 1);
  assert.equal(markedIssue, false);
});

test("POST /api/observability/jobs/[id]/review-findings/[findingId]/issue releases the claim when repo access lookup throws", async () => {
  const { createReviewFindingIssuePostHandler } =
    await loadReviewFindingIssueRoute();

  const releasedClaims: Array<{
    findingId: string;
    issueNumber?: number | null;
    issueUrl?: string | null;
  }> = [];

  const handler = createReviewFindingIssuePostHandler({
    requireUserId: async () => "user-1",
    claimOwnedReviewFindingIssueCreation: async () => ({
      outcome: "claimed",
      finding: makeReviewFinding({
        status: "issue_creating",
      }),
    }),
    getOwnedRepoWithGithubAccessToken: async () => {
      throw new Error("Repo access lookup failed");
    },
    createGithubIssue: async () => {
      throw new Error("createGithubIssue should not be called");
    },
    markReviewFindingIssueCreated: async () => {
      throw new Error("markReviewFindingIssueCreated should not be called");
    },
    releaseReviewFindingIssueCreationClaim: async (input) => {
      releasedClaims.push(input);
    },
  });

  const response = await handler(
    new Request(
      "http://localhost/api/observability/jobs/job-1/review-findings/finding-1/issue",
      {
        method: "POST",
      }
    ) as never,
    {
      params: Promise.resolve({ id: "job-1", findingId: "finding-1" }),
    }
  );

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: "Repo access lookup failed",
  });
  assert.deepEqual(releasedClaims, [
    {
      findingId: "finding-1",
      issueNumber: undefined,
      issueUrl: undefined,
    },
  ]);
});

test("POST /api/observability/jobs/[id]/review-findings/[findingId]/issue settles the claim with the created issue when link persistence fails", async () => {
  const { createReviewFindingIssuePostHandler } =
    await loadReviewFindingIssueRoute();

  const releasedClaims: Array<{
    findingId: string;
    issueNumber?: number | null;
    issueUrl?: string | null;
  }> = [];

  const handler = createReviewFindingIssuePostHandler({
    requireUserId: async () => "user-1",
    claimOwnedReviewFindingIssueCreation: async () => ({
      outcome: "claimed",
      finding: makeReviewFinding({
        status: "issue_creating",
      }),
    }),
    getOwnedRepoWithGithubAccessToken: async () => ({
      repo: {
        id: "repo-1",
        user_id: "user-1",
        full_name: "acme/widgets",
        github_installation_id: 123,
      },
      githubToken: "github-token",
    }),
    createGithubIssue: async () => ({
      issueNumber: 91,
      issueUrl: "https://github.com/acme/widgets/issues/91",
    }),
    markReviewFindingIssueCreated: async () => {
      throw new Error("Persist issue link failed");
    },
    releaseReviewFindingIssueCreationClaim: async (input) => {
      releasedClaims.push(input);
    },
  });

  const response = await handler(
    new Request(
      "http://localhost/api/observability/jobs/job-1/review-findings/finding-1/issue",
      {
        method: "POST",
      }
    ) as never,
    {
      params: Promise.resolve({ id: "job-1", findingId: "finding-1" }),
    }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    created: true,
    issueNumber: 91,
    issueUrl: "https://github.com/acme/widgets/issues/91",
  });
  assert.deepEqual(releasedClaims, [
    {
      findingId: "finding-1",
      issueNumber: 91,
      issueUrl: "https://github.com/acme/widgets/issues/91",
    },
  ]);
});
