import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

let data: typeof import("./command-data");

beforeAll(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  data = await import("./command-data");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const repo = {
  id: "11111111-1111-4111-8111-111111111111",
  full_name: "acme/widgets",
  installation_id: 42,
};

describe("Slack command data", () => {
  it("loads only the user's latest Slack run for the invoking actor", async () => {
    const row = { id: "run_1" };
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      contains: vi.fn(() => query),
      order: vi.fn(() => query),
      limit: vi.fn(() => query),
      maybeSingle: vi.fn(async () => ({ data: row, error: null })),
    };
    const client = { from: vi.fn(() => query) };

    await expect(
      data.loadLatestSlackRun({
        userId: "user-1",
        teamId: "T1",
        slackUserId: "U1",
        client: client as never,
      })
    ).resolves.toBe(row);
    expect(query.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(query.contains).toHaveBeenCalledWith("metadata", {
      slack_team_id: "T1",
      slack_user_id: "U1",
    });
    expect(query.order).toHaveBeenCalledWith("created_at", {
      ascending: false,
    });
  });

  it("returns personal plan and spendable credit without account internals", async () => {
    const summary = await data.loadSlackUsageSummary("user-1", {
      findBillingAccount: async () =>
        ({ id: "account-1", plan_code: "pro", status: "active" }) as never,
      getBalance: async () => ({
        includedCents: 500,
        purchasedCents: 250,
        totalCents: 750,
      }),
    });
    expect(summary).toEqual({
      plan: "pro",
      status: "active",
      includedCents: 500,
      purchasedCents: 250,
      totalCents: 750,
    });
  });

  it("loads and normalizes open pull-request readiness via GraphQL", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              repository: {
                pullRequests: {
                  totalCount: 2,
                  nodes: [
                    {
                      number: 17,
                      title: "Fix widget",
                      url: "https://github.com/acme/widgets/pull/17",
                      author: { login: "octocat" },
                      isDraft: false,
                      mergeable: "MERGEABLE",
                      reviewDecision: "APPROVED",
                      headRefOid: "a".repeat(40),
                      statusCheckRollup: { state: "SUCCESS" },
                      reviewThreads: {
                        nodes: [{ isResolved: false }, { isResolved: true }],
                      },
                    },
                    { number: 18, title: null },
                  ],
                },
              },
            },
          }),
          { status: 200 }
        )
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await data.listSlackRepoPullRequests({
      userId: "user-1",
      repo,
      deps: { getGithubToken: async () => "github-token" } as never,
    });

    expect(result.totalCount).toBe(2);
    expect(result.pullRequests).toEqual([
      expect.objectContaining({
        number: 17,
        mergeable: "mergeable",
        reviewDecision: "approved",
        checkState: "success",
        unresolvedReviewThreads: 1,
        headSha: "a".repeat(40),
      }),
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/graphql",
      expect.objectContaining({ method: "POST", cache: "no-store" })
    );
  });

  it("normalizes open issues from the linked repository", async () => {
    const result = await data.listSlackRepoIssues({
      userId: "user-1",
      repo,
      deps: {
        getGithubToken: async () => "github-token",
        graphql: async () => ({
          issues: {
            totalCount: 1,
            nodes: [
              {
                number: 9,
                title: "Broken widget",
                url: "https://github.com/acme/widgets/issues/9",
                author: { login: "octocat" },
                updatedAt: "2026-08-29T00:00:00Z",
              },
            ],
          },
        }),
      } as never,
    });
    expect(result).toEqual({
      totalCount: 1,
      issues: [
        {
          number: 9,
          title: "Broken widget",
          url: "https://github.com/acme/widgets/issues/9",
          author: "octocat",
          updatedAt: "2026-08-29T00:00:00Z",
        },
      ],
    });
  });

  it("pins issue creation and PR merge to the owned linked repo", async () => {
    const createIssue = vi.fn(async () => ({
      issueNumber: 9,
      issueUrl: "https://github.com/acme/widgets/issues/9",
    }));
    await data.createSlackRepoIssue({
      userId: "user-1",
      repo,
      title: "Broken widget",
      body: "Steps",
      deps: {
        getGithubToken: async () => "github-token",
        createIssue,
      } as never,
    });
    expect(createIssue).toHaveBeenCalledWith({
      githubToken: "github-token",
      repoFullName: repo.full_name,
      title: "Broken widget",
      body: "Steps",
    });

    const mergePullRequest = vi.fn(async () => ({
      merged: false,
      queued: true,
      reason: "checks pending",
    }));
    await data.mergeSlackRepoPullRequest({
      userId: "user-1",
      repo,
      prNumber: 17,
      expectedHeadSha: "a".repeat(40),
      deps: {
        getGithubToken: async () => "github-token",
        mergePullRequest,
      } as never,
    });
    expect(mergePullRequest).toHaveBeenCalledWith({
      githubToken: "github-token",
      owner: "acme",
      repo: "widgets",
      prNumber: 17,
      expectedHeadSha: "a".repeat(40),
    });
  });
});
