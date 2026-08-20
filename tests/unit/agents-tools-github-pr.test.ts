import assert from "node:assert/strict";
import test from "node:test";

import {
  loadToolsModule,
  parseJsonRequestBody,
  withEnv,
  withPatchedFetch,
  withPatchedGithubInstallations,
} from "./helpers/agents-tools-fixtures";

test("github_create_pull_request opens a scoped PR from the sandbox branch", async () => {
  const calls: Array<{
    method: string;
    path: string;
    query: string;
    body?: unknown;
  }> = [];

  await withPatchedFetch(
    async (url, init) => {
      const parsed = new URL(String(url));
      calls.push({
        method: init?.method ?? "GET",
        path: parsed.pathname,
        query: parsed.search,
        body: parseJsonRequestBody(init?.body),
      });
      if ((init?.method ?? "GET") === "GET") {
        return Response.json([]);
      }
      return Response.json({
        number: 42,
        html_url: "https://github.com/acme/demo/pull/42",
      });
    },
    async () => {
      const { createGithubPullRequestTool } = await loadToolsModule();
      const tool = createGithubPullRequestTool("github-token", {
        owner: "acme",
        repo: "demo",
        branch: "mogplex/fix-checkout",
        baseBranch: "main",
      }) as unknown as {
        execute: (input: { title: string; body: string }) => Promise<unknown>;
      };

      assert.deepEqual(
        await tool.execute({
          title: "Fix checkout",
          body: "Keeps the sandbox branch synchronized.",
        }),
        {
          ok: true,
          created: true,
          pullRequestNumber: 42,
          pullRequestUrl: "https://github.com/acme/demo/pull/42",
        }
      );
    }
  );

  assert.equal(calls[0]?.path, "/repos/acme/demo/pulls");
  assert.match(calls[0]?.query ?? "", /head=acme%3Amogplex%2Ffix-checkout/);
  assert.deepEqual(calls[1]?.body, {
    title: "Fix checkout",
    body: "Keeps the sandbox branch synchronized.",
    head: "mogplex/fix-checkout",
    base: "main",
  });
});

test("github_update_pull_request edits metadata on a scoped PR", async () => {
  const calls: Array<{
    method: string;
    path: string;
    body?: unknown;
  }> = [];

  await withPatchedFetch(
    async (url, init) => {
      const parsed = new URL(String(url));
      calls.push({
        method: init?.method ?? "GET",
        path: parsed.pathname,
        body: parseJsonRequestBody(init?.body),
      });
      return Response.json({
        number: 42,
        html_url: "https://github.com/acme/demo/pull/42",
        title: "Filter injected errors",
        body: "No-tests: covered by the existing filter suite.",
      });
    },
    async () => {
      const { createGithubPullRequestUpdateTool } = await loadToolsModule();
      const tool = createGithubPullRequestUpdateTool("github-token", {
        owner: "acme",
        repo: "demo",
      }) as unknown as {
        execute: (input: { number: number; body: string }) => Promise<unknown>;
      };

      assert.deepEqual(
        await tool.execute({
          number: 42,
          body: "No-tests: covered by the existing filter suite.",
        }),
        {
          ok: true,
          pullRequestNumber: 42,
          pullRequestUrl: "https://github.com/acme/demo/pull/42",
          title: "Filter injected errors",
          body: "No-tests: covered by the existing filter suite.",
        }
      );
    }
  );

  assert.deepEqual(calls, [
    {
      method: "PATCH",
      path: "/repos/acme/demo/pulls/42",
      body: { body: "No-tests: covered by the existing filter suite." },
    },
  ]);
});

test("github_pr_search uses one authenticated GraphQL search and returns draft status", async () => {
  const calls: Array<{
    url: string;
    authorization?: string;
    query?: string;
    first?: number;
  }> = [];

  await withPatchedFetch(
    async (url, init) => {
      const urlString = String(url);
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        variables?: { query?: string; first?: number };
      };
      calls.push({
        url: urlString,
        authorization:
          init?.headers instanceof Headers
            ? (init.headers.get("authorization") ?? undefined)
            : ((init?.headers as Record<string, string> | undefined)
                ?.Authorization ??
              (init?.headers as Record<string, string> | undefined)
                ?.authorization),
        query: body.variables?.query,
        first: body.variables?.first,
      });

      const parsed = new URL(urlString);
      if (parsed.pathname === "/graphql") {
        return Response.json({
          data: {
            search: {
              issueCount: 1,
              nodes: [
                {
                  __typename: "PullRequest",
                  repository: { nameWithOwner: "webrenew/drawit" },
                  number: 49,
                  title: "chore(deps): bump next to 16.2.6",
                  url: "https://github.com/webrenew/drawit/pull/49",
                  author: { login: "charlesrhoward" },
                  state: "OPEN",
                  isDraft: false,
                  createdAt: "2026-06-26T12:00:00Z",
                  updatedAt: "2026-06-27T12:00:00Z",
                },
              ],
            },
            rateLimit: {
              limit: 5000,
              remaining: 4999,
              resetAt: "2026-06-27T19:00:00Z",
            },
          },
        });
      }

      return Response.json({ message: "unexpected url" }, { status: 404 });
    },
    async () => {
      const { createGithubPrSearch } = await loadToolsModule();
      const tool = createGithubPrSearch({
        oauthToken: "gho-test",
        userId: "user-1",
      }) as unknown as {
        execute: (input: {
          owner: string;
          author: string;
          limit: number;
        }) => Promise<unknown>;
      };

      const result = (await tool.execute({
        owner: "webrenew",
        author: "charlesrhoward",
        limit: 5,
      })) as {
        ok: boolean;
        query: string;
        auth: { source: string; coverage: string };
        totalCount: number;
        items: Array<{
          repo: string;
          number: number;
          draft: boolean;
          url: string;
        }>;
      };

      assert.equal(result.ok, true);
      assert.equal(
        result.query,
        "is:pr is:open org:webrenew author:charlesrhoward sort:updated-desc"
      );
      assert.equal(result.auth.source, "oauth");
      assert.equal(result.auth.coverage, "oauth");
      assert.equal(result.totalCount, 1);
      assert.deepEqual(result.items, [
        {
          repo: "webrenew/drawit",
          number: 49,
          title: "chore(deps): bump next to 16.2.6",
          url: "https://github.com/webrenew/drawit/pull/49",
          author: "charlesrhoward",
          state: "open",
          draft: false,
          createdAt: "2026-06-26T12:00:00Z",
          updatedAt: "2026-06-27T12:00:00Z",
        },
      ]);
    }
  );

  assert.equal(calls.length, 1);
  assert.deepEqual(
    calls.map((call) => call.authorization),
    ["Bearer gho-test"]
  );
  assert.equal(
    calls[0]?.query,
    "is:pr is:open org:webrenew author:charlesrhoward sort:updated-desc"
  );
  assert.equal(calls[0]?.first, 5);
});

test("github_pr_search strips conflicting caller-supplied GitHub qualifiers", async () => {
  let query: string | undefined;

  await withPatchedFetch(
    async (url, init) => {
      assert.equal(new URL(String(url)).pathname, "/graphql");
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        variables?: { query?: string };
      };
      query = body.variables?.query;
      return Response.json({
        data: {
          search: { issueCount: 0, nodes: [] },
          rateLimit: { limit: 5000, remaining: 4999, resetAt: null },
        },
      });
    },
    async () => {
      const { createGithubPrSearch } = await loadToolsModule();
      const tool = createGithubPrSearch({
        oauthToken: "gho-test",
      }) as unknown as {
        execute: (input: {
          owner: string;
          author: string;
          query: string;
        }) => Promise<unknown>;
      };

      await tool.execute({
        owner: "webrenew",
        author: "charlesrhoward",
        query:
          "is:closed repo:other/repo author:somebody user:octocat bug is:draft draft:true",
      });
    }
  );

  assert.equal(
    query,
    "is:pr is:open org:webrenew author:charlesrhoward bug draft:true sort:updated-desc"
  );
});

test("github_pr_search rejects malformed owner repo and author inputs", async () => {
  const { createGithubPrSearch } = await loadToolsModule();
  const tool = createGithubPrSearch({ oauthToken: "gho-test" }) as unknown as {
    execute: (input: {
      owner?: string;
      repo?: string;
      author?: string;
    }) => Promise<{ error?: string }>;
  };

  assert.match(
    (await tool.execute({ owner: "bad/name" })).error ?? "",
    /owner must be a valid GitHub login/
  );
  assert.match(
    (await tool.execute({ owner: "webrenew", repo: "bad repo" })).error ?? "",
    /repo must be a valid GitHub repository name/
  );
  assert.match(
    (await tool.execute({ author: "-bad" })).error ?? "",
    /author must be a valid GitHub login/
  );
});

test("github_pr_search reports non-OK GitHub auth responses", async () => {
  await withPatchedFetch(
    async () => Response.json({ message: "Bad credentials" }, { status: 401 }),
    async () => {
      const { createGithubPrSearch } = await loadToolsModule();
      const tool = createGithubPrSearch({
        oauthToken: "gho-revoked",
      }) as unknown as {
        execute: (input: { author: string }) => Promise<unknown>;
      };

      const result = (await tool.execute({
        author: "charlesrhoward",
      })) as {
        ok: boolean;
        status: number;
        error: string;
        auth: { source: string };
      };

      assert.equal(result.ok, false);
      assert.equal(result.status, 401);
      assert.equal(result.error, "Bad credentials");
      assert.equal(result.auth.source, "oauth");
    }
  );
});

test("github_pr_search reshapes GitHub App installation lookup errors", async () => {
  await withEnv(
    {
      GITHUB_APP_ID: "12345",
      GITHUB_APP_NAME: "mogplex-test",
      GITHUB_APP_PRIVATE_KEY: "test-key",
    },
    async () => {
      await withPatchedGithubInstallations(
        { data: null, error: { message: "database unavailable" } },
        async () => {
          const { createGithubPrSearch } = await loadToolsModule();
          const tool = createGithubPrSearch({
            userId: "user-1",
          }) as unknown as {
            execute: (input: { owner: string }) => Promise<unknown>;
          };

          const result = (await tool.execute({
            owner: "webrenew",
          })) as { error?: string; warnings?: string[] };

          assert.match(result.error ?? "", /Authenticated GitHub PR search/);
          assert.match(result.warnings?.[0] ?? "", /database unavailable/);
        }
      );
    }
  );
});

test("github_pr_search surfaces a per-item warning when draft status is missing", async () => {
  await withPatchedFetch(
    async () =>
      Response.json({
        data: {
          search: {
            issueCount: 1,
            nodes: [
              {
                __typename: "PullRequest",
                repository: { nameWithOwner: "webrenew/drawit" },
                number: 49,
                title: "chore(deps): bump next to 16.2.6",
                url: "https://github.com/webrenew/drawit/pull/49",
                author: { login: "charlesrhoward" },
                state: "OPEN",
                createdAt: "2026-06-26T12:00:00Z",
                updatedAt: "2026-06-27T12:00:00Z",
              },
            ],
          },
          rateLimit: { limit: 5000, remaining: 4999, resetAt: null },
        },
      }),
    async () => {
      const { createGithubPrSearch } = await loadToolsModule();
      const tool = createGithubPrSearch({
        oauthToken: "gho-test",
      }) as unknown as {
        execute: (input: { owner: string }) => Promise<unknown>;
      };

      const result = (await tool.execute({ owner: "webrenew" })) as {
        items: Array<{ draft?: boolean; warnings?: string[] }>;
      };

      assert.equal("draft" in result.items[0], false);
      assert.match(result.items[0]?.warnings?.[0] ?? "", /Draft status/);
    }
  );
});

test("github_pr_search reports missing authenticated GitHub coverage", async () => {
  const { createGithubPrSearch } = await loadToolsModule();
  const tool = createGithubPrSearch({ userId: "user-1" }) as unknown as {
    execute: (input: { author: string }) => Promise<unknown>;
  };

  const result = (await tool.execute({
    author: "charlesrhoward",
  })) as { error?: string };

  assert.match(result.error ?? "", /Authenticated GitHub PR search/);
});
