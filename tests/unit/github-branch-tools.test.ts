import assert from "node:assert/strict";
import test from "node:test";
import {
  createTestGithubAppPrivateKey,
  withEnv,
  withPatchedFetch,
  withPatchedGithubInstallations,
} from "./helpers/agents-tools-fixtures";

const GITHUB_APP_ENV = {
  GITHUB_APP_ID: "12345",
  GITHUB_APP_NAME: "mogplex-test",
  GITHUB_APP_PRIVATE_KEY: createTestGithubAppPrivateKey(),
};

const toolCall = { toolCallId: "branches", messages: [], context: undefined };

async function loadBranchTools(options: Record<string, unknown> = {}) {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  const { createGithubBranchTools } =
    await import("../../lib/agents/tools/github-branches");
  return createGithubBranchTools({
    userId: "user-1",
    defaultRepo: { owner: "acme", repo: "widgets" },
    ...options,
  });
}

type Call = { method: string; path: string; search: string };

/**
 * A GitHub stand-in for acme/widgets: `main` is the default branch,
 * `release` is protected, `feature/open` has an open pull request, and
 * `feature/done` and `mogplex/task-1` are plain deletable branches.
 */
function fakeGithub(
  calls: Call[],
  overrides: Partial<Record<string, Response>> = {}
) {
  const branches: Record<string, { protected: boolean; sha: string }> = {
    main: { protected: true, sha: "a".repeat(40) },
    release: { protected: true, sha: "b".repeat(40) },
    "feature/open": { protected: false, sha: "c".repeat(40) },
    "feature/done": { protected: false, sha: "d".repeat(40) },
    "mogplex/task-1": { protected: false, sha: "e".repeat(40) },
  };
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const parsed = new URL(String(url));
    const method = init?.method ?? "GET";
    calls.push({ method, path: parsed.pathname, search: parsed.search });
    const override = overrides[`${method} ${parsed.pathname}`];
    if (override) return override;
    if (parsed.pathname === "/app/installations/321/access_tokens") {
      return Response.json({ token: "ghs-installation" });
    }
    if (parsed.pathname === "/repos/acme/widgets") {
      return Response.json({ default_branch: "main" });
    }
    const branchMatch = parsed.pathname.match(
      /^\/repos\/acme\/widgets\/branches\/(.+)$/
    );
    if (branchMatch) {
      const branch = branches[decodeURIComponent(branchMatch[1] as string)];
      if (!branch)
        return Response.json({ message: "Branch not found" }, { status: 404 });
      return Response.json({
        protected: branch.protected,
        commit: { sha: branch.sha },
      });
    }
    if (parsed.pathname === "/repos/acme/widgets/pulls") {
      const head = parsed.searchParams.get("head");
      return Response.json(head === "acme:feature/open" ? [{ number: 7 }] : []);
    }
    if (
      method === "DELETE" &&
      parsed.pathname.startsWith("/repos/acme/widgets/git/refs/heads/")
    ) {
      return new Response(null, { status: 204 });
    }
    if (
      method === "POST" &&
      parsed.pathname === "/repos/acme/widgets/git/refs"
    ) {
      return Response.json({ ref: "refs/heads/feature/done" }, { status: 201 });
    }
    throw new Error(`Unexpected request ${method} ${parsed.pathname}`);
  }) as typeof fetch;
}

async function withAcmeInstallation(callback: () => Promise<void>) {
  await withEnv(GITHUB_APP_ENV, async () => {
    await withPatchedGithubInstallations(
      { data: [{ installation_id: 321, account_login: "acme" }], error: null },
      callback
    );
  });
}

test("branch tools require an authenticated user", async () => {
  const tools = await loadBranchTools({ userId: null });
  for (const [name, input] of [
    ["github_list_branches", {}],
    ["github_delete_branches", { branches: ["feature/done"] }],
    ["github_create_branch", { branch: "feature/new" }],
  ] as const) {
    const result = await tools[name].execute!(input, toolCall);
    assert.match(
      (result as { error: string }).error,
      /not authenticated/i,
      name
    );
  }
});

test("branch tools ask for a repository when none is in context", async () => {
  const tools = await loadBranchTools({ defaultRepo: undefined });
  const result = await tools.github_delete_branches.execute!(
    { branches: ["feature/done"] },
    toolCall
  );
  assert.match(
    (result as { error: string }).error,
    /no repository is in context/i
  );
});

test("branch tools require an installation covering the owner", async () => {
  await withPatchedGithubInstallations({ data: [], error: null }, async () => {
    const tools = await loadBranchTools();
    const result = await tools.github_delete_branches.execute!(
      { branches: ["feature/done"] },
      toolCall
    );
    assert.match(
      (result as { error: string }).error,
      /install the mogplex github app on acme/i
    );
  });
});

test("branch tools refuse a repository the installation does not cover", async () => {
  const calls: Call[] = [];
  await withAcmeInstallation(async () => {
    await withPatchedFetch(
      fakeGithub(calls, {
        "GET /repos/acme/widgets": Response.json(
          { message: "Not Found" },
          { status: 404 }
        ),
      }),
      async () => {
        const tools = await loadBranchTools();
        const result = await tools.github_delete_branches.execute!(
          { branches: ["feature/done"] },
          toolCall
        );
        assert.match(
          (result as { error: string }).error,
          /cannot access acme\/widgets/i
        );
      }
    );
  });
  assert.equal(
    calls.some((call) => call.method === "DELETE"),
    false
  );
});

test("github_delete_branches deletes only unprotected branches without open pull requests", async () => {
  const calls: Call[] = [];
  await withAcmeInstallation(async () => {
    await withPatchedFetch(fakeGithub(calls), async () => {
      const tools = await loadBranchTools();
      const result = (await tools.github_delete_branches.execute!(
        {
          branches: [
            "main",
            "release",
            "feature/open",
            "feature/done",
            "mogplex/task-1",
            "gone",
            "bad..name",
            "feature/done",
          ],
        },
        toolCall
      )) as {
        deleted: number;
        notFound: number;
        skipped: number;
        results: unknown[];
      };
      assert.deepEqual(result.results, [
        { branch: "main", status: "skipped", reason: "default branch" },
        {
          branch: "release",
          status: "skipped",
          reason: "protected branch",
          sha: "b".repeat(40),
        },
        {
          branch: "feature/open",
          status: "skipped",
          reason: "open pull request #7; deleting the branch would close it",
          sha: "c".repeat(40),
        },
        { branch: "feature/done", status: "deleted", sha: "d".repeat(40) },
        { branch: "mogplex/task-1", status: "deleted", sha: "e".repeat(40) },
        { branch: "gone", status: "not_found" },
        {
          branch: "bad..name",
          status: "skipped",
          reason: "invalid branch name",
        },
      ]);
      assert.equal(result.deleted, 2);
      assert.equal(result.notFound, 1);
      assert.equal(result.skipped, 4);
    });
  });
  const deletes = calls
    .filter((call) => call.method === "DELETE")
    .map((call) => call.path);
  assert.deepEqual(deletes.sort(), [
    "/repos/acme/widgets/git/refs/heads/feature/done",
    "/repos/acme/widgets/git/refs/heads/mogplex/task-1",
  ]);
});

test("github_delete_branches records deletions in the team audit log", async () => {
  const audits: unknown[] = [];
  await withAcmeInstallation(async () => {
    await withPatchedFetch(fakeGithub([]), async () => {
      const tools = await loadBranchTools({
        teamId: "team-1",
        aiCallId: "call-1",
        recordAuditEvent: async (event: unknown) => {
          audits.push(event);
          return { ok: true };
        },
      });
      await tools.github_delete_branches.execute!(
        { branches: ["feature/done", "release"] },
        toolCall
      );
    });
  });
  assert.deepEqual(audits, [
    {
      productTeamId: "team-1",
      actorUserId: "user-1",
      action: "github.branch.delete",
      decisionCode: "deleted",
      targetType: "github_repository",
      targetId: "acme/widgets",
      correlations: { aiCallId: "call-1", requestId: null },
      payload: { branches: [{ branch: "feature/done", sha: "d".repeat(40) }] },
    },
  ]);
});

test("github_create_branch restores a deleted branch at its returned SHA", async () => {
  const calls: Array<Call & { body?: unknown }> = [];
  const github = fakeGithub(calls);
  await withAcmeInstallation(async () => {
    await withPatchedFetch(
      (async (url, init) => {
        const response = await github(url, init);
        if (init?.method === "POST" && String(url).endsWith("/git/refs")) {
          calls[calls.length - 1]!.body = JSON.parse(String(init.body));
        }
        return response;
      }) as typeof fetch,
      async () => {
        const tools = await loadBranchTools();
        const result = await tools.github_create_branch.execute!(
          { branch: "feature/done", from: "D".repeat(40) },
          toolCall
        );
        assert.deepEqual(result, {
          ok: true,
          repo: "acme/widgets",
          branch: "feature/done",
          sha: "d".repeat(40),
        });
      }
    );
  });
  assert.deepEqual(
    calls.find((call) => call.path === "/repos/acme/widgets/git/refs")?.body,
    {
      ref: "refs/heads/feature/done",
      sha: "d".repeat(40),
    }
  );
});

test("github_create_branch rejects an invalid branch name before calling GitHub", async () => {
  const calls: Call[] = [];
  await withPatchedFetch(fakeGithub(calls), async () => {
    const tools = await loadBranchTools();
    const result = await tools.github_create_branch.execute!(
      { branch: "-bad" },
      toolCall
    );
    assert.match(
      (result as { error: string }).error,
      /not a valid branch name/
    );
  });
  assert.equal(calls.length, 0);
});

test("github_list_branches classifies a page and returns its cursor", async () => {
  const calls: Call[] = [];
  const github = fakeGithub(calls, {
    "POST /graphql": Response.json({
      data: {
        repository: {
          defaultBranchRef: { name: "main" },
          refs: {
            totalCount: 3,
            pageInfo: { hasNextPage: true, endCursor: "cursor-2" },
            nodes: [
              {
                name: "main",
                branchProtectionRule: { id: "r" },
                target: { oid: "a" },
                compare: { behindBy: 0 },
                associatedPullRequests: { nodes: [] },
              },
              {
                name: "mogplex/task-1",
                branchProtectionRule: null,
                target: { oid: "e" },
                compare: { behindBy: 0 },
                associatedPullRequests: { nodes: [] },
              },
              {
                name: "feature/wip",
                branchProtectionRule: null,
                target: { oid: "f" },
                compare: { behindBy: 3 },
                associatedPullRequests: { nodes: [] },
              },
            ],
          },
        },
      },
    }),
  });
  await withAcmeInstallation(async () => {
    await withPatchedFetch(github, async () => {
      const tools = await loadBranchTools();
      const result = (await tools.github_list_branches.execute!(
        { cursor: "cursor-1" },
        toolCall
      )) as Record<string, unknown>;
      assert.equal(result.nextCursor, "cursor-2");
      assert.deepEqual(result.safeToDelete, ["mogplex/task-1"]);
      assert.deepEqual(result.counts, { default: 1, merged: 1, unmerged: 1 });
    });
  });
});
