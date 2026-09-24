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

test("GitHub issue writes require an authenticated user", async () => {
  const { createGithubIssueCommentTool, createGithubIssueUpdateTool } =
    await loadToolsModule();
  for (const tool of [
    createGithubIssueCommentTool(),
    createGithubIssueUpdateTool(),
  ]) {
    const result = await tool.execute!(
      { owner: "acme", repo: "widgets", number: 42, body: "Requested change" },
      { toolCallId: "write", messages: [], context: undefined }
    );
    assert.match((result as { error: string }).error, /not authenticated/i);
  }
});

test("GitHub issue writes require an installation accessible to the current user", async () => {
  await withPatchedGithubInstallations({ data: [], error: null }, async () => {
    const { createGithubIssueCommentTool, createGithubIssueUpdateTool } =
      await loadToolsModule();
    for (const tool of [
      createGithubIssueCommentTool({ userId: "user-1" }),
      createGithubIssueUpdateTool({ userId: "user-1" }),
    ]) {
      const result = await tool.execute!(
        {
          owner: "acme",
          repo: "widgets",
          number: 42,
          body: "Requested change",
        },
        { toolCallId: "write", messages: [], context: undefined }
      );
      assert.match(
        (result as { error: string }).error,
        /connect that repository/i
      );
    }
  });
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

test("issue writes report GitHub permission failures without claiming success", async () => {
  await withAcmeInstallation(async () => {
    const calls: string[] = [];
    await withPatchedFetch(
      async (url, init) => {
        if (new URL(String(url)).pathname.endsWith("/access_tokens")) {
          return Response.json({ token: "ghs-installation" });
        }
        calls.push(init?.method ?? "GET");
        return Response.json(
          { message: "Resource not accessible by integration" },
          { status: 403 }
        );
      },
      async () => {
        const { createGithubIssueUpdateTool, createGithubIssueCommentTool } =
          await loadToolsModule();
        for (const tool of [
          createGithubIssueUpdateTool({ userId: "user-1" }),
          createGithubIssueCommentTool({ userId: "user-1" }),
        ]) {
          const result = (await tool.execute!(
            {
              owner: "acme",
              repo: "widgets",
              number: 42,
              body: "Requested change",
            },
            { toolCallId: "write", messages: [], context: undefined }
          )) as { ok?: boolean; error?: string };
          assert.equal(result.ok, undefined);
          assert.match(result.error ?? "", /not accessible/);
        }
      }
    );
    assert.deepEqual(calls, ["GET", "POST"]);
  });
});

test("issue writes reject invalid repository targets before network access", async () => {
  await withPatchedFetch(
    async () => {
      throw new Error("Unexpected network call");
    },
    async () => {
      const { createGithubIssueUpdateTool } = await loadToolsModule();
      const tool = createGithubIssueUpdateTool({ userId: "user-1" });
      for (const target of [
        { owner: "../acme", repo: "widgets" },
        { owner: "acme", repo: "widgets/../../other" },
      ]) {
        const result = await tool.execute!(
          { ...target, number: 42, body: "Requested change" },
          { toolCallId: "write", messages: [], context: undefined }
        );
        assert.match(
          (result as { error: string }).error,
          /must be a valid GitHub/
        );
      }
    }
  );
});
