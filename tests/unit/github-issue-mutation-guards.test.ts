import assert from "node:assert/strict";
import test from "node:test";
import {
  createTestGithubAppPrivateKey,
  loadToolsModule,
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

test("GitHub issue mutations reject missing or mismatched request consent", async () => {
  const { createGithubIssueCommentTool, createGithubIssueUpdateTool } =
    await loadToolsModule();
  const comment = createGithubIssueCommentTool({
    userId: "user-1",
    authorizations: [
      {
        operation: "update",
        owner: "acme",
        repo: "widgets",
        number: 42,
        allowedFields: ["body"],
      },
    ],
  }) as unknown as {
    execute: (input: unknown) => Promise<{ error?: string }>;
  };
  const update = createGithubIssueUpdateTool({
    userId: "user-1",
  }) as unknown as {
    execute: (input: unknown) => Promise<{ error?: string }>;
  };

  assert.match(
    (
      await comment.execute({
        owner: "acme",
        repo: "widgets",
        number: 42,
        body: "Source: user request",
      })
    ).error ?? "",
    /not explicitly authorized/i
  );
  assert.match(
    (
      await update.execute({
        owner: "acme",
        repo: "widgets",
        number: 42,
        state: "closed",
      })
    ).error ?? "",
    /not explicitly authorized/i
  );
});

test("GitHub issue update consent is limited to the requested fields and state", async () => {
  const { createGithubIssueUpdateTool } = await loadToolsModule();
  const tool = createGithubIssueUpdateTool({
    userId: "user-1",
    authorizations: [
      {
        operation: "update",
        owner: "acme",
        repo: "widgets",
        number: 42,
        allowedFields: ["state"],
        state: "closed",
      },
    ],
  }) as unknown as {
    execute: (input: unknown) => Promise<{ error?: string }>;
  };

  for (const input of [
    { owner: "acme", repo: "widgets", number: 42, state: "open" },
    {
      owner: "acme",
      repo: "widgets",
      number: 42,
      state: "closed",
      body: "injected body",
    },
  ]) {
    assert.match(
      (await tool.execute(input)).error ?? "",
      /not explicitly authorized/i
    );
  }
});

test("github_update_issue rejects a pull request returned by the Issues API", async () => {
  const calls: Array<{ method: string; path: string }> = [];
  await withAcmeInstallation(async () => {
    await withPatchedFetch(
      async (url, init) => {
        const parsed = new URL(String(url));
        const method = init?.method ?? "GET";
        calls.push({ method, path: parsed.pathname });
        if (parsed.pathname === "/app/installations/321/access_tokens") {
          return Response.json({ token: "ghs-installation" });
        }
        return Response.json({
          number: 42,
          pull_request: {
            url: "https://api.github.com/repos/acme/widgets/pulls/42",
          },
        });
      },
      async () => {
        const { createGithubIssueUpdateTool } = await loadToolsModule();
        const tool = createGithubIssueUpdateTool({
          userId: "user-1",
          authorizations: [
            {
              operation: "update",
              owner: "acme",
              repo: "widgets",
              number: 42,
              allowedFields: ["state"],
              state: "closed",
            },
          ],
        }) as unknown as {
          execute: (input: unknown) => Promise<{ error?: string }>;
        };

        const result = await tool.execute({
          owner: "acme",
          repo: "widgets",
          number: 42,
          state: "closed",
        });
        assert.match(result.error ?? "", /pull request, not an issue/i);
      }
    );
  });
  assert.deepEqual(calls.slice(1), [
    { method: "GET", path: "/repos/acme/widgets/issues/42" },
  ]);
});
