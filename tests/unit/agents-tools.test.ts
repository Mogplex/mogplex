import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

async function loadToolsModule() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../lib/agents/tools");
}

async function loadRestToolModule() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../lib/connections/rest-tool");
}

function withEnv<T>(
  overrides: Record<string, string | undefined>,
  callback: () => Promise<T>
) {
  const original = new Map<string, string | undefined>();

  for (const [key, value] of Object.entries(overrides)) {
    original.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  return callback().finally(() => {
    for (const [key, value] of original.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });
}

async function withPatchedSandboxLookup<T>(
  data: { id: string } | null,
  callback: () => Promise<T>,
  options?: { repoLookupData?: { id: string } | null }
) {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  const { supabaseAdmin } = await import("../../lib/supabase/admin");
  const originalFrom = supabaseAdmin.from.bind(supabaseAdmin);

  const query = {
    select() {
      return query;
    },
    eq() {
      return query;
    },
    order() {
      return query;
    },
    limit() {
      return query;
    },
    async single() {
      return { data, error: null };
    },
    async maybeSingle() {
      return { data: options?.repoLookupData ?? null, error: null };
    },
  };

  Object.defineProperty(supabaseAdmin, "from", {
    configurable: true,
    writable: true,
    value: () => query,
  });

  try {
    return await callback();
  } finally {
    Object.defineProperty(supabaseAdmin, "from", {
      configurable: true,
      writable: true,
      value: originalFrom,
    });
  }
}

async function withPatchedFetch<T>(
  impl: typeof fetch,
  callback: () => Promise<T>
) {
  const originalFetch = global.fetch;
  Object.defineProperty(global, "fetch", {
    configurable: true,
    writable: true,
    value: impl,
  });

  try {
    return await callback();
  } finally {
    Object.defineProperty(global, "fetch", {
      configurable: true,
      writable: true,
      value: originalFetch,
    });
  }
}

function readAuthorizationHeader(init?: RequestInit) {
  if (init?.headers instanceof Headers) {
    return init.headers.get("authorization") ?? undefined;
  }
  const headers = init?.headers as Record<string, string> | undefined;
  return headers?.Authorization ?? headers?.authorization;
}

function parseJsonRequestBody(body: BodyInit | null | undefined) {
  return typeof body === "string" ? (JSON.parse(body) as unknown) : undefined;
}

type GithubInstallationsQueryCall = {
  method: "select" | "eq" | "ilike" | "limit";
  column?: string;
  value?: unknown;
};

async function withPatchedGithubInstallations<T>(
  result: {
    data: Array<{
      installation_id?: number | null;
      account_login?: string | null;
    }> | null;
    error: { message: string } | null;
  },
  callback: () => Promise<T>,
  calls: GithubInstallationsQueryCall[] = []
) {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  const { supabaseAdmin } = await import("../../lib/supabase/admin");
  const originalFrom = supabaseAdmin.from.bind(supabaseAdmin);

  const query = {
    select(columns: string) {
      calls.push({ method: "select", value: columns });
      return query;
    },
    eq(column: string, value: unknown) {
      calls.push({ method: "eq", column, value });
      return query;
    },
    ilike(column: string, value: unknown) {
      calls.push({ method: "ilike", column, value });
      return query;
    },
    limit(value: number) {
      calls.push({ method: "limit", value });
      return Promise.resolve(result);
    },
  };

  Object.defineProperty(supabaseAdmin, "from", {
    configurable: true,
    writable: true,
    value: (table: string) =>
      table === "github_installations" ? query : originalFrom(table),
  });

  try {
    return await callback();
  } finally {
    Object.defineProperty(supabaseAdmin, "from", {
      configurable: true,
      writable: true,
      value: originalFrom,
    });
  }
}

let testGithubAppPrivateKey: string | null = null;

function createTestGithubAppPrivateKey() {
  // Shared across tests for speed; tests that need key rotation should reset it.
  testGithubAppPrivateKey ??= crypto
    .generateKeyPairSync("rsa", { modulusLength: 2048 })
    .privateKey.export({ type: "pkcs8", format: "pem" })
    .toString();
  return testGithubAppPrivateKey;
}

test("start_sandbox normalizes JSON reuse responses from /api/sandbox", async () => {
  await withEnv({ INTERNAL_API_SECRET: "internal-secret" }, async () => {
    await withPatchedSandboxLookup(null, async () => {
      await withPatchedFetch(
        async () =>
          Response.json(
            {
              sandbox: {
                id: "sandbox-record-1",
                status: "installing",
              },
            },
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          ),
        async () => {
          const { createStartSandbox } = await loadToolsModule();
          const tool = createStartSandbox("user-123") as unknown as {
            execute: (input: { repoId: string }) => Promise<unknown>;
          };

          const result = await tool.execute({
            repoId: "1b4f0e2a-2c3d-4e5f-8a9b-0c1d2e3f4a5b",
          });

          assert.deepEqual(result, {
            ok: true,
            sandboxId: "sandbox-record-1",
            status: "pending",
            message:
              "Sandbox startup is already in progress. The preview pane will update automatically when it's ready.",
          });
        }
      );
    });
  });
});

test("start_sandbox returns as soon as sandbox creation is acknowledged over SSE", async () => {
  const encoder = new TextEncoder();

  await withEnv({ INTERNAL_API_SECRET: "internal-secret" }, async () => {
    await withPatchedSandboxLookup(null, async () => {
      await withPatchedFetch(
        async () => {
          let readyTimer: ReturnType<typeof setTimeout> | null = null;
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ type: "sandbox_created", recordId: "sandbox-record-2" })}\n\n`
                )
              );
              readyTimer = setTimeout(() => {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ type: "ready", sandbox: { id: "sandbox-record-2" } })}\n\n`
                  )
                );
                controller.close();
              }, 250);
            },
            cancel() {
              if (readyTimer) {
                clearTimeout(readyTimer);
                readyTimer = null;
              }
            },
          });

          return new Response(stream, {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          });
        },
        async () => {
          const { createStartSandbox } = await loadToolsModule();
          const tool = createStartSandbox("user-123") as unknown as {
            execute: (input: { repoId: string }) => Promise<unknown>;
          };

          const result = await Promise.race([
            tool.execute({
              repoId: "1b4f0e2a-2c3d-4e5f-8a9b-0c1d2e3f4a5b",
            }),
            new Promise<never>((_, reject) =>
              setTimeout(
                () =>
                  reject(
                    new Error("Timed out waiting for sandbox_created result")
                  ),
                100
              )
            ),
          ]);

          assert.deepEqual(result, {
            ok: true,
            sandboxId: "sandbox-record-2",
            status: "pending",
            message:
              "Sandbox is launching. The preview pane will update automatically when it's ready.",
          });
        }
      );
    });
  });
});

test("start_sandbox fails closed when a full_name does not resolve even if another sandbox is already running", async () => {
  await withEnv({ INTERNAL_API_SECRET: "internal-secret" }, async () => {
    await withPatchedSandboxLookup(
      { id: "sandbox-unrelated" },
      async () => {
        const { createStartSandbox } = await loadToolsModule();
        const tool = createStartSandbox("user-123") as unknown as {
          execute: (input: { repoId: string }) => Promise<unknown>;
        };

        const result = (await tool.execute({
          repoId: "webrenew/missing-repo",
        })) as { error?: string; sandboxId?: string };

        assert.equal(result.error, "Failed to start sandbox");
        assert.equal(result.sandboxId, undefined);
      },
      { repoLookupData: null }
    );
  });
});

test("start_sandbox rejects invalid non-UUID repoIds instead of reusing another sandbox", async () => {
  await withEnv({ INTERNAL_API_SECRET: "internal-secret" }, async () => {
    await withPatchedSandboxLookup({ id: "sandbox-unrelated" }, async () => {
      const { createStartSandbox } = await loadToolsModule();
      const tool = createStartSandbox("user-123") as unknown as {
        execute: (input: { repoId: string }) => Promise<unknown>;
      };

      const result = (await tool.execute({
        repoId: "repo-123",
      })) as { error?: string; sandboxId?: string };

      assert.equal(result.error, "Failed to start sandbox");
      assert.equal(result.sandboxId, undefined);
    });
  });
});

test("start_sandbox resolves a GitHub full_name to the repo UUID before posting", async () => {
  await withEnv({ INTERNAL_API_SECRET: "internal-secret" }, async () => {
    await withPatchedSandboxLookup(
      null,
      async () => {
        const capturedBodies: string[] = [];
        await withPatchedFetch(
          async (_url, init) => {
            capturedBodies.push(
              typeof init?.body === "string" ? init.body : ""
            );
            return Response.json(
              { sandbox: { id: "sandbox-xyz", status: "running" } },
              {
                status: 200,
                headers: { "Content-Type": "application/json" },
              }
            );
          },
          async () => {
            const { createStartSandbox } = await loadToolsModule();
            const tool = createStartSandbox("user-123") as unknown as {
              execute: (input: { repoId: string }) => Promise<unknown>;
            };

            const result = (await tool.execute({
              repoId: "webrenew/bloom",
            })) as { ok: boolean; sandboxId: string };

            assert.equal(result.ok, true);
            assert.equal(result.sandboxId, "sandbox-xyz");
            assert.equal(capturedBodies.length, 1);
            assert.deepEqual(JSON.parse(capturedBodies[0]), {
              repoId: "1b4f0e2a-2c3d-4e5f-8a9b-0c1d2e3f4a5b",
            });
          }
        );
      },
      {
        repoLookupData: { id: "1b4f0e2a-2c3d-4e5f-8a9b-0c1d2e3f4a5b" },
      }
    );
  });
});

test("start_sandbox returns an error when a full_name does not map to an owned repo", async () => {
  await withEnv({ INTERNAL_API_SECRET: "internal-secret" }, async () => {
    await withPatchedSandboxLookup(null, async () => {
      const { createStartSandbox } = await loadToolsModule();
      const tool = createStartSandbox("user-123") as unknown as {
        execute: (input: { repoId: string }) => Promise<unknown>;
      };

      const result = (await tool.execute({
        repoId: "webrenew/unknown-repo",
      })) as { error?: string };

      assert.equal(result.error, "Failed to start sandbox");
    });
  });
});

test("buildStaticTools exposes inputSchema for every built-in tool", async () => {
  const { buildStaticTools } = await loadToolsModule();
  const tools = buildStaticTools();

  assert.equal("web_fetch" in tools, true);

  for (const [name, builtTool] of Object.entries(tools)) {
    assert.ok(
      "inputSchema" in builtTool && builtTool.inputSchema,
      `${name} is missing inputSchema`
    );
  }
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

test("webFetch rejects localhost targets before fetching", async () => {
  const { webFetch } = await loadToolsModule();
  const tool = webFetch as unknown as {
    execute: (input: { url: string }) => Promise<unknown>;
  };

  await assert.rejects(
    () => tool.execute({ url: "http://localhost:3000" }),
    /url must target a public host/
  );
});

test("webFetch schema does not advertise selector extraction", async () => {
  const { webFetch } = await loadToolsModule();
  const tool = webFetch as unknown as {
    inputSchema: { shape: Record<string, unknown> };
  };

  assert.deepEqual(Object.keys(tool.inputSchema.shape), ["url"]);
});

test("createRestApiTool exposes inputSchema for provider validation", async () => {
  const { createRestApiTool } = await loadRestToolModule();
  const tool = createRestApiTool(
    {
      id: "conn-1",
      user_id: "user-1",
      name: "Acme",
      type: "rest_api",
      base_url: "https://api.example.com",
      auth_type: "bearer",
      auth_header: null,
      mcp_transport: null,
      mcp_url: null,
      description: "Test API",
      is_enabled: true,
      health_status: "healthy",
      scope: "global",
      repo_id: null,
      oauth_client_id: null,
      oauth_authorize_url: null,
      oauth_token_url: null,
      oauth_scopes: null,
      oauth_authorized_at: null,
      oauth_token_expires_at: null,
      source_preset: null,
      last_tested_at: null,
      last_test_error: null,
      last_test_http_status: null,
      last_test_tool_count: null,
      created_at: "2026-04-12T00:00:00.000Z",
      updated_at: "2026-04-12T00:00:00.000Z",
    },
    "secret-token"
  );

  assert.ok("inputSchema" in tool && tool.inputSchema);
});

test("terminal_exec reports a missing exitCode as null rather than 0", async () => {
  // A malformed sandbox response used to be asserted into a number, so the
  // model read a missing exit code as a clean exit. Keep it as "unknown".
  await withEnv({ INTERNAL_API_SECRET: "internal-secret" }, async () => {
    await withPatchedFetch(
      async () =>
        Response.json(
          { stdout: "partial output" },
          { status: 200, headers: { "Content-Type": "application/json" } }
        ),
      async () => {
        const { createTerminalExec } = await loadToolsModule();
        const tool = createTerminalExec("sandbox-1", "user-123") as unknown as {
          execute: (input: { command: string }) => Promise<unknown>;
        };

        assert.deepEqual(await tool.execute({ command: "pnpm build" }), {
          exitCode: null,
          stdout: "partial output",
          stderr: "",
          command: "pnpm build",
        });
      }
    );
  });
});

test("terminal_exec passes a zero exit code through untouched", async () => {
  await withEnv({ INTERNAL_API_SECRET: "internal-secret" }, async () => {
    await withPatchedFetch(
      async () =>
        Response.json(
          { exitCode: 0, stdout: "ok", stderr: "warn" },
          { status: 200, headers: { "Content-Type": "application/json" } }
        ),
      async () => {
        const { createTerminalExec } = await loadToolsModule();
        const tool = createTerminalExec("sandbox-1", "user-123") as unknown as {
          execute: (input: { command: string }) => Promise<unknown>;
        };

        assert.deepEqual(await tool.execute({ command: "true" }), {
          exitCode: 0,
          stdout: "ok",
          stderr: "warn",
          command: "true",
        });
      }
    );
  });
});
