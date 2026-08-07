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
  type GithubInstallationsQueryCall,
} from "./helpers/agents-tools-fixtures";

test("github_pr_search prefers requested owner GitHub App installation auth", async () => {
  const calls: Array<{ path: string; authorization?: string }> = [];
  const installationQueryCalls: GithubInstallationsQueryCall[] = [];

  await withEnv(
    {
      GITHUB_APP_ID: "12345",
      GITHUB_APP_NAME: "mogplex-test",
      GITHUB_APP_PRIVATE_KEY: createTestGithubAppPrivateKey(),
    },
    async () => {
      await withPatchedGithubInstallations(
        {
          data: [{ installation_id: 321, account_login: "webrenew" }],
          error: null,
        },
        async () => {
          await withPatchedFetch(
            async (url, init) => {
              const parsed = new URL(String(url));
              const authorization =
                init?.headers instanceof Headers
                  ? (init.headers.get("authorization") ?? undefined)
                  : ((init?.headers as Record<string, string> | undefined)
                      ?.Authorization ??
                    (init?.headers as Record<string, string> | undefined)
                      ?.authorization);
              calls.push({ path: parsed.pathname, authorization });

              if (parsed.pathname === "/app/installations/321/access_tokens") {
                return Response.json({ token: "ghs-installation" });
              }

              if (parsed.pathname === "/graphql") {
                const body = JSON.parse(String(init?.body ?? "{}")) as {
                  variables?: { query?: string };
                };
                assert.equal(authorization, "Bearer ghs-installation");
                assert.equal(
                  body.variables?.query,
                  "is:pr is:open repo:webrenew/drawit sort:updated-desc"
                );
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
                      remaining: 4998,
                      resetAt: "2026-06-27T19:00:00Z",
                    },
                  },
                });
              }

              return Response.json(
                { message: "unexpected url" },
                { status: 404 }
              );
            },
            async () => {
              const { createGithubPrSearch } = await loadToolsModule();
              const tool = createGithubPrSearch({
                oauthToken: "gho-test",
                userId: "user-1",
              }) as unknown as {
                execute: (input: {
                  owner: string;
                  repo: string;
                }) => Promise<unknown>;
              };

              const result = (await tool.execute({
                owner: "webrenew",
                repo: "drawit",
              })) as {
                ok: boolean;
                auth: { source: string; coverage: string };
                items: Array<{ repo: string }>;
              };

              assert.equal(result.ok, true);
              assert.equal(result.auth.source, "github_app_installation");
              assert.equal(result.auth.coverage, "app");
              assert.equal(result.items[0]?.repo, "webrenew/drawit");
            }
          );
        },
        installationQueryCalls
      );
    }
  );

  assert.deepEqual(installationQueryCalls, [
    { method: "select", value: "installation_id, account_login" },
    { method: "eq", column: "user_id", value: "user-1" },
    { method: "ilike", column: "account_login", value: "webrenew" },
    { method: "limit", value: 1 },
  ]);
  assert.deepEqual(
    calls.map((call) => call.path),
    ["/app/installations/321/access_tokens", "/graphql"]
  );
});

test("github_pr_search retries the next credential after an auth failure", async () => {
  const calls: Array<{ path: string; authorization?: string }> = [];

  await withEnv(
    {
      GITHUB_APP_ID: "12345",
      GITHUB_APP_NAME: "mogplex-test",
      GITHUB_APP_PRIVATE_KEY: createTestGithubAppPrivateKey(),
    },
    async () => {
      await withPatchedGithubInstallations(
        {
          data: [{ installation_id: 321, account_login: "webrenew" }],
          error: null,
        },
        async () => {
          await withPatchedFetch(
            async (url, init) => {
              const parsed = new URL(String(url));
              const authorization =
                init?.headers instanceof Headers
                  ? (init.headers.get("authorization") ?? undefined)
                  : ((init?.headers as Record<string, string> | undefined)
                      ?.Authorization ??
                    (init?.headers as Record<string, string> | undefined)
                      ?.authorization);
              calls.push({ path: parsed.pathname, authorization });

              if (parsed.pathname === "/app/installations/321/access_tokens") {
                return Response.json({ token: "ghs-installation" });
              }
              if (
                parsed.pathname === "/graphql" &&
                authorization === "Bearer ghs-installation"
              ) {
                return Response.json(
                  { message: "Resource not accessible by integration" },
                  { status: 403 }
                );
              }
              if (
                parsed.pathname === "/graphql" &&
                authorization === "Bearer gho-test"
              ) {
                return Response.json({
                  data: {
                    search: { issueCount: 0, nodes: [] },
                    rateLimit: {
                      limit: 5000,
                      remaining: 4998,
                      resetAt: "2026-06-27T19:00:00Z",
                    },
                  },
                });
              }

              return Response.json(
                { message: "unexpected url" },
                { status: 404 }
              );
            },
            async () => {
              const { createGithubPrSearch } = await loadToolsModule();
              const tool = createGithubPrSearch({
                oauthToken: "gho-test",
                userId: "user-1",
              }) as unknown as {
                execute: (input: { owner: string }) => Promise<unknown>;
              };

              const result = (await tool.execute({
                owner: "webrenew",
              })) as {
                ok: boolean;
                auth: { source: string };
                warnings?: string[];
              };

              assert.equal(result.ok, true);
              assert.equal(result.auth.source, "oauth");
              assert.match(result.warnings?.[0] ?? "", /retried/);
            }
          );
        }
      );
    }
  );

  assert.equal(calls[0]?.path, "/app/installations/321/access_tokens");
  assert.match(calls[0]?.authorization ?? "", /^Bearer /);
  assert.deepEqual(
    calls.slice(1).map((call) => call.authorization),
    ["Bearer ghs-installation", "Bearer gho-test"]
  );
});

test("github_pr_search retries OAuth after GraphQL auth errors with HTTP 200", async () => {
  const calls: Array<{ path: string; authorization?: string }> = [];

  await withEnv(
    {
      GITHUB_APP_ID: "12345",
      GITHUB_APP_NAME: "mogplex-test",
      GITHUB_APP_PRIVATE_KEY: createTestGithubAppPrivateKey(),
    },
    async () => {
      await withPatchedGithubInstallations(
        {
          data: [{ installation_id: 321, account_login: "webrenew" }],
          error: null,
        },
        async () => {
          await withPatchedFetch(
            async (url, init) => {
              const parsed = new URL(String(url));
              const authorization =
                init?.headers instanceof Headers
                  ? (init.headers.get("authorization") ?? undefined)
                  : ((init?.headers as Record<string, string> | undefined)
                      ?.Authorization ??
                    (init?.headers as Record<string, string> | undefined)
                      ?.authorization);
              calls.push({ path: parsed.pathname, authorization });

              if (parsed.pathname === "/app/installations/321/access_tokens") {
                return Response.json({ token: "ghs-installation" });
              }
              if (
                parsed.pathname === "/graphql" &&
                authorization === "Bearer ghs-installation"
              ) {
                return Response.json({
                  errors: [
                    {
                      type: "FORBIDDEN",
                      message: "Resource not accessible by integration",
                    },
                  ],
                });
              }
              if (
                parsed.pathname === "/graphql" &&
                authorization === "Bearer gho-test"
              ) {
                return Response.json({
                  data: {
                    search: { issueCount: 0, nodes: [] },
                    rateLimit: {
                      limit: 5000,
                      remaining: 4998,
                      resetAt: "2026-06-27T19:00:00Z",
                    },
                  },
                });
              }

              return Response.json(
                { message: "unexpected url" },
                { status: 404 }
              );
            },
            async () => {
              const { createGithubPrSearch } = await loadToolsModule();
              const tool = createGithubPrSearch({
                oauthToken: "gho-test",
                userId: "user-1",
              }) as unknown as {
                execute: (input: { owner: string }) => Promise<unknown>;
              };

              const result = (await tool.execute({
                owner: "webrenew",
              })) as {
                ok: boolean;
                auth: { source: string };
                warnings?: string[];
              };

              assert.equal(result.ok, true);
              assert.equal(result.auth.source, "oauth");
              assert.match(result.warnings?.[0] ?? "", /GraphQL error/);
              assert.match(result.warnings?.[0] ?? "", /retried/);
              assert.doesNotMatch(
                result.warnings?.[0] ?? "",
                /private repositories|requested owner/
              );
            }
          );
        }
      );
    }
  );

  assert.deepEqual(
    calls.slice(1).map((call) => call.authorization),
    ["Bearer ghs-installation", "Bearer gho-test"]
  );
});

test("github_create_issue uses the linked user's GitHub App installation", async () => {
  const calls: Array<{
    path: string;
    method: string;
    authorization?: string;
    body?: unknown;
  }> = [];

  await withEnv(
    {
      GITHUB_APP_ID: "12345",
      GITHUB_APP_NAME: "mogplex-test",
      GITHUB_APP_PRIVATE_KEY: createTestGithubAppPrivateKey(),
    },
    async () => {
      await withPatchedGithubInstallations(
        {
          data: [{ installation_id: 321, account_login: "webrenew" }],
          error: null,
        },
        async () => {
          await withPatchedFetch(
            async (url, init) => {
              const parsed = new URL(String(url));
              calls.push({
                path: parsed.pathname,
                method: init?.method ?? "GET",
                authorization: readAuthorizationHeader(init),
                body: parseJsonRequestBody(init?.body),
              });

              if (parsed.pathname === "/app/installations/321/access_tokens") {
                return Response.json({ token: "ghs-installation" });
              }
              if (parsed.pathname === "/repos/webrenew/tools/issues") {
                return Response.json({
                  number: 125,
                  html_url: "https://github.com/webrenew/tools/issues/125",
                });
              }

              return Response.json(
                { message: "unexpected url" },
                { status: 404 }
              );
            },
            async () => {
              const { createGithubIssueTool } = await loadToolsModule();
              const tool = createGithubIssueTool({
                userId: "user-1",
              }) as unknown as {
                execute: (input: {
                  owner: string;
                  repo: string;
                  title: string;
                  body: string;
                  labels: string[];
                }) => Promise<unknown>;
              };

              const result = await tool.execute({
                owner: "webrenew",
                repo: "tools",
                title: "Ensure Stripe creations have project metadata",
                body: "Audit every Stripe create call.",
                labels: ["bug", "billing"],
              });

              assert.deepEqual(result, {
                ok: true,
                repo: "webrenew/tools",
                issueNumber: 125,
                issueUrl: "https://github.com/webrenew/tools/issues/125",
              });
            }
          );
        }
      );
    }
  );

  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.path, "/app/installations/321/access_tokens");
  assert.equal(calls[0]?.method, "POST");
  assert.equal(calls[1]?.path, "/repos/webrenew/tools/issues");
  assert.equal(calls[1]?.method, "POST");
  assert.equal(calls[1]?.authorization, "Bearer ghs-installation");
  assert.deepEqual(calls[1]?.body, {
    title: "Ensure Stripe creations have project metadata",
    body: "Audit every Stripe create call.",
    labels: ["bug", "billing"],
  });
});

test("github_create_issue rejects malformed repo scope before GitHub access", async () => {
  const { createGithubIssueTool } = await loadToolsModule();
  const tool = createGithubIssueTool({ userId: "user-1" }) as unknown as {
    execute: (input: {
      owner: string;
      repo: string;
      title: string;
    }) => Promise<{ error?: string }>;
  };

  assert.match(
    (
      await tool.execute({
        owner: "webrenew/other",
        repo: "tools",
        title: "Test",
      })
    ).error ?? "",
    /owner must be a valid GitHub login/
  );
});
