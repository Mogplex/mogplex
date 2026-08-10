import assert from "node:assert/strict";
import test from "node:test";

import {
  createTestGithubAppPrivateKey,
  loadToolsModule,
  readAuthorizationHeader,
  withEnv,
  withPatchedFetch,
  withPatchedGithubInstallations,
} from "./helpers/agents-tools-fixtures";

const REPO_FIXTURES = [
  {
    full_name: "mogplex/mogplex",
    private: true,
    description: "App",
    language: "TypeScript",
    default_branch: "main",
    updated_at: "2026-08-09T12:00:00Z",
    html_url: "https://github.com/mogplex/mogplex",
    owner: { login: "mogplex" },
  },
  {
    full_name: "mogplex/docs",
    private: false,
    description: "Docs",
    language: "MDX",
    default_branch: "main",
    updated_at: "2026-08-08T12:00:00Z",
    html_url: "https://github.com/mogplex/docs",
    owner: { login: "mogplex" },
  },
];

type ExecutedRepoList = {
  execute: (input: {
    owner?: string;
    query?: string;
    visibility?: "all" | "public" | "private";
    limit?: number;
  }) => Promise<{
    error?: string;
    totalCount?: number;
    items?: Array<{ fullName: string | null; private: boolean | null }>;
  }>;
};

test("github_list_repos lists private repos via the owner's installation token", async () => {
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
          data: [{ installation_id: 321, account_login: "mogplex" }],
          error: null,
        },
        async () => {
          await withPatchedFetch(
            async (url, init) => {
              const parsed = new URL(String(url));
              calls.push({
                path: parsed.pathname,
                authorization: readAuthorizationHeader(init),
              });
              if (parsed.pathname === "/app/installations/321/access_tokens") {
                return Response.json({ token: "ghs-installation" });
              }
              if (parsed.pathname === "/installation/repositories") {
                assert.equal(
                  readAuthorizationHeader(init),
                  "Bearer ghs-installation"
                );
                return Response.json({
                  total_count: 2,
                  repositories: REPO_FIXTURES,
                });
              }
              return Response.json({ message: "unexpected" }, { status: 404 });
            },
            async () => {
              const { createGithubRepoList } = await loadToolsModule();
              const tool = createGithubRepoList({
                userId: "user-1",
              }) as unknown as ExecutedRepoList;

              const result = await tool.execute({ owner: "mogplex" });

              assert.equal(result.error, undefined);
              assert.equal(result.totalCount, 2);
              assert.deepEqual(
                result.items?.map((item) => [item.fullName, item.private]),
                [
                  ["mogplex/mogplex", true],
                  ["mogplex/docs", false],
                ]
              );
            }
          );
        }
      );
    }
  );

  assert.ok(
    calls.some((call) => call.path === "/installation/repositories"),
    "expected an authenticated /installation/repositories call"
  );
});

test("github_list_repos aggregates installations and OAuth, deduped, when owner is omitted", async () => {
  await withEnv(
    {
      GITHUB_APP_ID: "12345",
      GITHUB_APP_NAME: "mogplex-test",
      GITHUB_APP_PRIVATE_KEY: createTestGithubAppPrivateKey(),
    },
    async () => {
      await withPatchedGithubInstallations(
        {
          data: [{ installation_id: 321, account_login: "mogplex" }],
          error: null,
        },
        async () => {
          await withPatchedFetch(
            async (url, init) => {
              const parsed = new URL(String(url));
              if (parsed.pathname === "/app/installations/321/access_tokens") {
                return Response.json({ token: "ghs-installation" });
              }
              if (parsed.pathname === "/installation/repositories") {
                return Response.json({
                  total_count: 1,
                  repositories: [REPO_FIXTURES[0]],
                });
              }
              if (parsed.pathname === "/user/repos") {
                assert.equal(readAuthorizationHeader(init), "Bearer gho-test");
                // Overlaps with the installation repo plus one extra.
                return Response.json([
                  REPO_FIXTURES[0],
                  {
                    ...REPO_FIXTURES[1],
                    full_name: "charlesrhoward/notes",
                    private: true,
                    owner: { login: "charlesrhoward" },
                  },
                ]);
              }
              return Response.json({ message: "unexpected" }, { status: 404 });
            },
            async () => {
              const { createGithubRepoList } = await loadToolsModule();
              const tool = createGithubRepoList({
                oauthToken: "gho-test",
                userId: "user-1",
              }) as unknown as ExecutedRepoList;

              const result = await tool.execute({});

              assert.equal(result.error, undefined);
              assert.deepEqual(
                result.items?.map((item) => item.fullName).sort(),
                ["charlesrhoward/notes", "mogplex/mogplex"]
              );
            }
          );
        }
      );
    }
  );
});

test("github_list_repos filters by query and visibility", async () => {
  await withEnv({}, async () => {
    await withPatchedFetch(
      async (url) => {
        const parsed = new URL(String(url));
        if (parsed.pathname === "/user/repos") {
          return Response.json(REPO_FIXTURES);
        }
        return Response.json({ message: "unexpected" }, { status: 404 });
      },
      async () => {
        const { createGithubRepoList } = await loadToolsModule();
        const tool = createGithubRepoList({
          oauthToken: "gho-test",
        }) as unknown as ExecutedRepoList;

        const result = await tool.execute({
          query: "docs",
          visibility: "public",
        });

        assert.equal(result.error, undefined);
        assert.deepEqual(
          result.items?.map((item) => item.fullName),
          ["mogplex/docs"]
        );
      }
    );
  });
});

test("github_list_repos rejects a malformed owner", async () => {
  const { createGithubRepoList } = await loadToolsModule();
  const tool = createGithubRepoList({
    oauthToken: "gho-test",
  }) as unknown as ExecutedRepoList;

  const result = await tool.execute({ owner: "-bad-" });
  assert.match(result.error ?? "", /valid GitHub login/);
});
