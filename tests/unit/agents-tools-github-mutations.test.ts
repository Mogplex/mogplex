import assert from "node:assert/strict";
import test from "node:test";

import {
  createTestGithubAppPrivateKey,
  loadToolsModule,
  parseJsonRequestBody,
  readAuthorizationHeader,
  withEnv,
  withPatchedFetch,
  withPatchedGithubInstallations,
} from "./helpers/agents-tools-fixtures";

const GITHUB_APP_ENV = {
  GITHUB_APP_ID: "12345",
  GITHUB_APP_NAME: "mogplex-test",
  GITHUB_APP_PRIVATE_KEY: createTestGithubAppPrivateKey(),
};

async function withAcmeInstallation(callback: () => Promise<void>) {
  await withEnv(GITHUB_APP_ENV, async () => {
    await withPatchedGithubInstallations(
      {
        data: [{ installation_id: 321, account_login: "acme" }],
        error: null,
      },
      callback
    );
  });
}

test("github_update_issue annotates an existing issue through the requested installation", async () => {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];

  await withAcmeInstallation(async () => {
    await withPatchedFetch(
      async (url, init) => {
        const parsed = new URL(String(url));
        calls.push({
          method: init?.method ?? "GET",
          path: parsed.pathname,
          body: parseJsonRequestBody(init?.body),
        });
        if (parsed.pathname === "/app/installations/321/access_tokens") {
          return Response.json({ token: "ghs-installation" });
        }
        return Response.json({
          number: 42,
          html_url: "https://github.com/acme/widgets/issues/42",
          title: "Prevent unsafe fallback",
          body: "Source: user request",
          state: "open",
        });
      },
      async () => {
        const { createGithubIssueUpdateTool } = await loadToolsModule();
        const tool = createGithubIssueUpdateTool({
          userId: "user-1",
        }) as unknown as {
          execute: (input: {
            owner: string;
            repo: string;
            number: number;
            body: string;
          }) => Promise<unknown>;
        };

        assert.deepEqual(
          await tool.execute({
            owner: "acme",
            repo: "widgets",
            number: 42,
            body: "Source: user request",
          }),
          {
            ok: true,
            repo: "acme/widgets",
            issueNumber: 42,
            issueUrl: "https://github.com/acme/widgets/issues/42",
            title: "Prevent unsafe fallback",
            body: "Source: user request",
            state: "open",
          }
        );
      }
    );
  });

  assert.deepEqual(calls.slice(1), [
    {
      method: "PATCH",
      path: "/repos/acme/widgets/issues/42",
      body: { body: "Source: user request" },
    },
  ]);
});

test("github_comment_issue adds an annotation without replacing the issue body", async () => {
  const calls: Array<{
    method: string;
    path: string;
    authorization?: string;
    body?: unknown;
  }> = [];

  await withAcmeInstallation(async () => {
    await withPatchedFetch(
      async (url, init) => {
        const parsed = new URL(String(url));
        calls.push({
          method: init?.method ?? "GET",
          path: parsed.pathname,
          authorization: readAuthorizationHeader(init),
          body: parseJsonRequestBody(init?.body),
        });
        if (parsed.pathname === "/app/installations/321/access_tokens") {
          return Response.json({ token: "ghs-installation" });
        }
        return Response.json({
          id: 901,
          html_url:
            "https://github.com/acme/widgets/issues/42#issuecomment-901",
          body: "Source: user request",
        });
      },
      async () => {
        const { createGithubIssueCommentTool } = await loadToolsModule();
        const tool = createGithubIssueCommentTool({
          userId: "user-1",
        }) as unknown as {
          execute: (input: {
            owner: string;
            repo: string;
            number: number;
            body: string;
          }) => Promise<unknown>;
        };

        assert.deepEqual(
          await tool.execute({
            owner: "acme",
            repo: "widgets",
            number: 42,
            body: "Source: user request",
          }),
          {
            ok: true,
            repo: "acme/widgets",
            issueNumber: 42,
            commentUrl:
              "https://github.com/acme/widgets/issues/42#issuecomment-901",
            body: "Source: user request",
          }
        );
      }
    );
  });

  assert.equal(calls[1]?.authorization, "Bearer ghs-installation");
  assert.deepEqual(calls.slice(1), [
    {
      method: "POST",
      path: "/repos/acme/widgets/issues/42/comments",
      authorization: "Bearer ghs-installation",
      body: { body: "Source: user request" },
    },
  ]);
});

test("github_pull_request_status returns the reviewed head, checks, and unresolved findings", async () => {
  await withAcmeInstallation(async () => {
    await withPatchedFetch(
      async (url) => {
        const parsed = new URL(String(url));
        if (parsed.pathname === "/app/installations/321/access_tokens") {
          return Response.json({ token: "ghs-installation" });
        }
        return Response.json({
          data: {
            repository: {
              pullRequest: {
                number: 84,
                title: "Improve widgets",
                url: "https://github.com/acme/widgets/pull/84",
                state: "OPEN",
                isDraft: false,
                headRefOid: "4928f94e852191d761352294ae1eabfa34b7d0ab",
                mergeable: "MERGEABLE",
                reviewDecision: "CHANGES_REQUESTED",
                statusCheckRollup: {
                  state: "FAILURE",
                  contexts: {
                    nodes: [
                      {
                        __typename: "CheckRun",
                        name: "test",
                        status: "COMPLETED",
                        conclusion: "FAILURE",
                        detailsUrl: "https://ci.example/check/1",
                      },
                    ],
                  },
                },
                reviews: {
                  nodes: [
                    {
                      author: { login: "reviewer" },
                      state: "CHANGES_REQUESTED",
                      submittedAt: "2026-08-29T12:00:00Z",
                      url: "https://github.com/acme/widgets/pull/84#review-1",
                    },
                  ],
                },
                reviewThreads: {
                  totalCount: 1,
                  nodes: [
                    {
                      isResolved: false,
                      comments: {
                        nodes: [
                          {
                            author: { login: "reviewer" },
                            body: "Handle the error path.",
                            createdAt: "2026-08-29T12:01:00Z",
                            url: "https://github.com/acme/widgets/pull/84#discussion-1",
                          },
                        ],
                      },
                    },
                  ],
                },
              },
            },
          },
        });
      },
      async () => {
        const { createGithubPullRequestStatusTool } = await loadToolsModule();
        const tool = createGithubPullRequestStatusTool({
          userId: "user-1",
        }) as unknown as {
          execute: (input: {
            owner: string;
            repo: string;
            number: number;
          }) => Promise<Record<string, unknown>>;
        };

        const result = await tool.execute({
          owner: "acme",
          repo: "widgets",
          number: 84,
        });
        assert.equal(
          result.headSha,
          "4928f94e852191d761352294ae1eabfa34b7d0ab"
        );
        assert.deepEqual(result.checks, [
          {
            name: "test",
            status: "completed",
            conclusion: "failure",
            url: "https://ci.example/check/1",
          },
        ]);
        assert.equal(result.unresolvedReviewThreadCount, 1);
        assert.deepEqual(result.unresolvedReviewThreads, [
          {
            comments: [
              {
                author: "reviewer",
                body: "Handle the error path.",
                createdAt: "2026-08-29T12:01:00Z",
                url: "https://github.com/acme/widgets/pull/84#discussion-1",
              },
            ],
          },
        ]);
      }
    );
  });
});

test("github_merge_pull_request safely merges a PR in another installed repository", async () => {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];

  await withAcmeInstallation(async () => {
    await withPatchedFetch(
      async (url, init) => {
        const parsed = new URL(String(url));
        calls.push({
          method: init?.method ?? "GET",
          path: parsed.pathname,
          body: parseJsonRequestBody(init?.body),
        });
        if (parsed.pathname === "/app/installations/321/access_tokens") {
          return Response.json({ token: "ghs-installation" });
        }
        if (parsed.pathname === "/repos/acme/widgets/pulls/84") {
          return Response.json({
            state: "open",
            draft: false,
            mergeable: true,
            mergeable_state: "clean",
            node_id: "PR_84",
            head: { sha: "4928f94e852191d761352294ae1eabfa34b7d0ab" },
          });
        }
        return Response.json({
          merged: true,
          sha: "6a6add1716c3fd2dc8ca76600638b445df6a7a07",
        });
      },
      async () => {
        const { createGithubPullRequestMergeTool } = await loadToolsModule();
        const tool = createGithubPullRequestMergeTool({
          userId: "user-1",
          authorization: {
            owner: "acme",
            repo: "widgets",
            number: 84,
          },
        }) as unknown as {
          execute: (input: {
            owner: string;
            repo: string;
            number: number;
            expectedHeadSha: string;
          }) => Promise<unknown>;
        };

        assert.deepEqual(
          await tool.execute({
            owner: "acme",
            repo: "widgets",
            number: 84,
            expectedHeadSha: "4928f94e852191d761352294ae1eabfa34b7d0ab",
          }),
          {
            ok: true,
            repo: "acme/widgets",
            pullRequestNumber: 84,
            merged: true,
            queued: false,
            reason: "Merged after clean review",
            sha: "6a6add1716c3fd2dc8ca76600638b445df6a7a07",
          }
        );
      }
    );
  });

  assert.deepEqual(calls.slice(1), [
    {
      method: "GET",
      path: "/repos/acme/widgets/pulls/84",
      body: undefined,
    },
    {
      method: "PUT",
      path: "/repos/acme/widgets/pulls/84/merge",
      body: {
        merge_method: "squash",
        sha: "4928f94e852191d761352294ae1eabfa34b7d0ab",
      },
    },
  ]);
});

test("github_merge_pull_request rejects a model-selected target without request consent", async () => {
  const { createGithubPullRequestMergeTool } = await loadToolsModule();
  const tool = createGithubPullRequestMergeTool({
    userId: "user-1",
  }) as unknown as {
    execute: (input: {
      owner: string;
      repo: string;
      number: number;
      expectedHeadSha: string;
    }) => Promise<{ error?: string }>;
  };

  const result = await tool.execute({
    owner: "acme",
    repo: "widgets",
    number: 84,
    expectedHeadSha: "4928f94e852191d761352294ae1eabfa34b7d0ab",
  });
  assert.match(result.error ?? "", /not explicitly authorized/i);
});
