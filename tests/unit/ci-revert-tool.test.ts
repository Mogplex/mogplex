import assert from "node:assert/strict";
import test from "node:test";
import { buildCITools, buildRevertBranchName } from "../../lib/agents/ci-tools";

type ToolLike = {
  execute: (
    input: Record<string, unknown>,
    options?: unknown
  ) => Promise<unknown>;
};

function mockFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>
) {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

const FAILING_SHA = "badc0ffee0000000000000000000000000000000";
const PARENT_SHA = "0000000000000000000000000000000000000001";

test("createRevertPr is only exposed when revert config is provided", () => {
  const withoutRevert = buildCITools({
    githubToken: "token",
    owner: "acme",
    repo: "widgets",
  });
  assert.ok(!("createRevertPr" in withoutRevert));

  const withRevert = buildCITools({
    githubToken: "token",
    owner: "acme",
    repo: "widgets",
    revert: { failingSha: FAILING_SHA, branch: "main" },
  });
  assert.ok("createRevertPr" in withRevert);
});

test("createRevertPr opens a revert PR when the failing commit is still the branch head", async () => {
  const tools = buildCITools({
    githubToken: "token",
    owner: "acme",
    repo: "widgets",
    revert: { failingSha: FAILING_SHA, branch: "main" },
  });

  const mocked = mockFetch((url, init) => {
    if (url.includes("/pulls?head=")) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (url.endsWith("/git/ref/heads/main")) {
      return new Response(JSON.stringify({ object: { sha: FAILING_SHA } }), {
        status: 200,
      });
    }
    if (url.endsWith(`/git/commits/${FAILING_SHA}`)) {
      return new Response(
        JSON.stringify({
          message: "feat: break the build\n\nlong body",
          parents: [{ sha: PARENT_SHA }],
        }),
        { status: 200 }
      );
    }
    if (url.endsWith(`/git/commits/${PARENT_SHA}`)) {
      return new Response(JSON.stringify({ tree: { sha: "parenttree" } }), {
        status: 200,
      });
    }
    if (url.endsWith("/git/commits") && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as {
        tree: string;
        parents: string[];
      };
      assert.equal(body.tree, "parenttree");
      assert.deepEqual(body.parents, [FAILING_SHA]);
      return new Response(JSON.stringify({ sha: "revertsha" }), {
        status: 201,
      });
    }
    if (url.endsWith("/git/refs") && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as { ref: string };
      assert.equal(
        body.ref,
        `refs/heads/${buildRevertBranchName(FAILING_SHA, "main")}`
      );
      return new Response(JSON.stringify({}), { status: 201 });
    }
    if (url.endsWith("/pulls") && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as {
        title: string;
        base: string;
      };
      assert.equal(body.base, "main");
      assert.ok(body.title.includes('Revert "feat: break the build"'));
      return new Response(
        JSON.stringify({ number: 55, html_url: "https://github.com/pr/55" }),
        { status: 201 }
      );
    }
    return new Response("unexpected", { status: 500 });
  });
  try {
    const result = await (
      (tools as Record<string, unknown>).createRevertPr as ToolLike
    ).execute({
      reason: "Broke typecheck on main.",
    });
    assert.deepEqual(result, {
      success: true,
      pr_number: 55,
      url: "https://github.com/pr/55",
    });
  } finally {
    mocked.restore();
  }
});

test("createRevertPr refuses when the branch has moved past the failing commit", async () => {
  const tools = buildCITools({
    githubToken: "token",
    owner: "acme",
    repo: "widgets",
    revert: { failingSha: FAILING_SHA, branch: "main" },
  });

  const mocked = mockFetch((url) => {
    if (url.includes("/pulls?head=")) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (url.endsWith("/git/ref/heads/main")) {
      return new Response(JSON.stringify({ object: { sha: "someothersha" } }), {
        status: 200,
      });
    }
    return new Response("unexpected", { status: 500 });
  });
  try {
    const result = (await (
      (tools as Record<string, unknown>).createRevertPr as ToolLike
    ).execute({ reason: "r" })) as { success: boolean; error?: string };
    assert.equal(result.success, false);
    assert.ok(result.error?.includes("has moved past"));
    // Only the PR precheck and head check ran — no mutations were attempted.
    assert.equal(mocked.calls.length, 2);
  } finally {
    mocked.restore();
  }
});

test("createRevertPr refuses merge and root commits", async () => {
  const tools = buildCITools({
    githubToken: "token",
    owner: "acme",
    repo: "widgets",
    revert: { failingSha: FAILING_SHA, branch: "main" },
  });

  const mocked = mockFetch((url) => {
    if (url.includes("/pulls?head=")) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (url.endsWith("/git/ref/heads/main")) {
      return new Response(JSON.stringify({ object: { sha: FAILING_SHA } }), {
        status: 200,
      });
    }
    if (url.endsWith(`/git/commits/${FAILING_SHA}`)) {
      return new Response(
        JSON.stringify({
          message: "Merge branch 'x'",
          parents: [{ sha: "p1" }, { sha: "p2" }],
        }),
        { status: 200 }
      );
    }
    return new Response("unexpected", { status: 500 });
  });
  try {
    const result = (await (
      (tools as Record<string, unknown>).createRevertPr as ToolLike
    ).execute({ reason: "r" })) as { success: boolean; error?: string };
    assert.equal(result.success, false);
    assert.ok(result.error?.includes("zero or multiple parents"));
  } finally {
    mocked.restore();
  }
});

test("createRevertPr reuses an existing open revert PR instead of failing", async () => {
  const tools = buildCITools({
    githubToken: "token",
    owner: "acme",
    repo: "widgets",
    revert: { failingSha: FAILING_SHA, branch: "main" },
  });

  const mocked = mockFetch((url) => {
    if (url.includes("/pulls?head=")) {
      return new Response(
        JSON.stringify([
          {
            number: 90,
            html_url: "https://github.com/pr/90",
            base: { ref: "main" },
          },
        ]),
        { status: 200 }
      );
    }
    return new Response("unexpected", { status: 500 });
  });
  try {
    const result = await (
      (tools as Record<string, unknown>).createRevertPr as ToolLike
    ).execute({ reason: "r" });
    assert.deepEqual(result, {
      success: true,
      pr_number: 90,
      url: "https://github.com/pr/90",
      reused: true,
    });
    assert.equal(mocked.calls.length, 1);
  } finally {
    mocked.restore();
  }
});

function leftoverBranchMock(leftoverTip: {
  parents: Array<{ sha: string }>;
  tree: { sha: string };
}) {
  let patched = false;
  const handler = (url: string, init?: RequestInit) => {
    if (url.includes("/pulls?head=")) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (url.endsWith("/git/ref/heads/main")) {
      return new Response(JSON.stringify({ object: { sha: FAILING_SHA } }), {
        status: 200,
      });
    }
    if (url.endsWith(`/git/commits/${FAILING_SHA}`)) {
      return new Response(
        JSON.stringify({
          message: "feat: bad",
          parents: [{ sha: PARENT_SHA }],
        }),
        { status: 200 }
      );
    }
    if (url.endsWith(`/git/commits/${PARENT_SHA}`)) {
      return new Response(JSON.stringify({ tree: { sha: "t" } }), {
        status: 200,
      });
    }
    if (url.endsWith("/git/commits/leftover")) {
      return new Response(JSON.stringify(leftoverTip), { status: 200 });
    }
    if (url.endsWith("/git/commits") && init?.method === "POST") {
      return new Response(JSON.stringify({ sha: "revertsha" }), {
        status: 201,
      });
    }
    if (url.endsWith("/git/refs") && init?.method === "POST") {
      return new Response("already exists", { status: 422 });
    }
    if (!init?.method && url.includes("/git/ref/heads/mogplex/revert-")) {
      // Collision-vs-invalid check: the leftover ref really exists.
      return new Response(JSON.stringify({ object: { sha: "leftover" } }), {
        status: 200,
      });
    }
    if (init?.method === "PATCH" && url.includes("/git/refs/heads/")) {
      patched = true;
      return new Response(JSON.stringify({}), { status: 200 });
    }
    if (url.endsWith("/pulls") && init?.method === "POST") {
      return new Response(
        JSON.stringify({ number: 91, html_url: "https://github.com/pr/91" }),
        { status: 201 }
      );
    }
    return new Response("unexpected", { status: 500 });
  };
  return { handler, wasPatched: () => patched };
}

test("createRevertPr reuses a verified leftover revert branch without force-updating it", async () => {
  const tools = buildCITools({
    githubToken: "token",
    owner: "acme",
    repo: "widgets",
    revert: { failingSha: FAILING_SHA, branch: "main" },
  });

  // The leftover tip is exactly the tree-swap revert this call would produce:
  // sole parent is the failing commit, tree is the parent's tree.
  const mock = leftoverBranchMock({
    parents: [{ sha: FAILING_SHA }],
    tree: { sha: "t" },
  });
  const mocked = mockFetch(mock.handler);
  try {
    const result = await (
      (tools as Record<string, unknown>).createRevertPr as ToolLike
    ).execute({ reason: "r" });
    assert.deepEqual(result, {
      success: true,
      pr_number: 91,
      url: "https://github.com/pr/91",
    });
    assert.equal(mock.wasPatched(), false);
  } finally {
    mocked.restore();
  }
});

test("createRevertPr refuses to overwrite an unrelated branch at the revert ref name", async () => {
  const tools = buildCITools({
    githubToken: "token",
    owner: "acme",
    repo: "widgets",
    revert: { failingSha: FAILING_SHA, branch: "main" },
  });

  // Someone else's branch occupies the deterministic name: its tip is not a
  // revert of the failing commit. The call must abort without any PATCH.
  const mock = leftoverBranchMock({
    parents: [{ sha: "unrelated-commit" }],
    tree: { sha: "other-tree" },
  });
  const mocked = mockFetch(mock.handler);
  try {
    const result = (await (
      (tools as Record<string, unknown>).createRevertPr as ToolLike
    ).execute({ reason: "r" })) as { success: boolean; error?: string };
    assert.equal(result.success, false);
    assert.ok(result.error?.includes("refusing to overwrite"));
    assert.equal(mock.wasPatched(), false);
  } finally {
    mocked.restore();
  }
});

test("createRevertPr deletes its own branch when PR creation fails", async () => {
  const tools = buildCITools({
    githubToken: "token",
    owner: "acme",
    repo: "widgets",
    revert: { failingSha: FAILING_SHA, branch: "main" },
  });

  let deleted = false;
  const mocked = mockFetch((url, init) => {
    if (url.includes("/pulls?head=")) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (url.endsWith("/git/ref/heads/main")) {
      return new Response(JSON.stringify({ object: { sha: FAILING_SHA } }), {
        status: 200,
      });
    }
    if (!init?.method && url.includes("/git/ref/heads/mogplex/revert-")) {
      // Ownership check before cleanup: the ref still points at the commit
      // this call created.
      return new Response(JSON.stringify({ object: { sha: "revertsha" } }), {
        status: 200,
      });
    }
    if (url.endsWith(`/git/commits/${FAILING_SHA}`)) {
      return new Response(
        JSON.stringify({
          message: "feat: bad",
          parents: [{ sha: PARENT_SHA }],
        }),
        { status: 200 }
      );
    }
    if (url.endsWith(`/git/commits/${PARENT_SHA}`)) {
      return new Response(JSON.stringify({ tree: { sha: "t" } }), {
        status: 200,
      });
    }
    if (url.endsWith("/git/commits") && init?.method === "POST") {
      return new Response(JSON.stringify({ sha: "revertsha" }), {
        status: 201,
      });
    }
    if (url.endsWith("/git/refs") && init?.method === "POST") {
      return new Response(JSON.stringify({}), { status: 201 });
    }
    if (init?.method === "DELETE" && url.includes("/git/refs/heads/")) {
      deleted = true;
      return new Response(null, { status: 204 });
    }
    if (url.endsWith("/pulls") && init?.method === "POST") {
      return new Response("boom", { status: 502 });
    }
    return new Response("unexpected", { status: 500 });
  });
  try {
    const result = (await (
      (tools as Record<string, unknown>).createRevertPr as ToolLike
    ).execute({ reason: "r" })) as { success: boolean };
    assert.equal(result.success, false);
    assert.equal(deleted, true);
  } finally {
    mocked.restore();
  }
});

test("createRevertPr targets the failing branch, not the repo default", async () => {
  const tools = buildCITools({
    githubToken: "token",
    owner: "acme",
    repo: "widgets",
    revert: { failingSha: FAILING_SHA, branch: "release/2.x" },
  });

  const mocked = mockFetch((url, init) => {
    if (url.includes("/pulls?head=")) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (url.endsWith("/git/ref/heads/release/2.x")) {
      return new Response(JSON.stringify({ object: { sha: FAILING_SHA } }), {
        status: 200,
      });
    }
    if (url.endsWith(`/git/commits/${FAILING_SHA}`)) {
      return new Response(
        JSON.stringify({
          message: "feat: bad",
          parents: [{ sha: PARENT_SHA }],
        }),
        { status: 200 }
      );
    }
    if (url.endsWith(`/git/commits/${PARENT_SHA}`)) {
      return new Response(JSON.stringify({ tree: { sha: "t" } }), {
        status: 200,
      });
    }
    if (url.endsWith("/git/commits") && init?.method === "POST") {
      return new Response(JSON.stringify({ sha: "revertsha" }), {
        status: 201,
      });
    }
    if (url.endsWith("/git/refs") && init?.method === "POST") {
      return new Response(JSON.stringify({}), { status: 201 });
    }
    if (url.endsWith("/pulls") && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as { base: string };
      assert.equal(body.base, "release/2.x");
      return new Response(
        JSON.stringify({ number: 92, html_url: "https://github.com/pr/92" }),
        { status: 201 }
      );
    }
    return new Response("unexpected", { status: 500 });
  });
  try {
    const result = (await (
      (tools as Record<string, unknown>).createRevertPr as ToolLike
    ).execute({ reason: "r" })) as { success: boolean };
    assert.equal(result.success, true);
  } finally {
    mocked.restore();
  }
});

test("createRevertPr fails closed when the existing-PR lookup fails", async () => {
  const tools = buildCITools({
    githubToken: "token",
    owner: "acme",
    repo: "widgets",
    revert: { failingSha: FAILING_SHA, branch: "main" },
  });

  const mocked = mockFetch((url) => {
    if (url.includes("/pulls?head=")) {
      return new Response("rate limited", { status: 503 });
    }
    return new Response("unexpected", { status: 500 });
  });
  try {
    const result = (await (
      (tools as Record<string, unknown>).createRevertPr as ToolLike
    ).execute({ reason: "r" })) as { success: boolean; error?: string };
    assert.equal(result.success, false);
    assert.ok(result.error?.includes("could not verify"));
    // The lookup was the only call — nothing was mutated on an unverified
    // "no existing PR" answer.
    assert.equal(mocked.calls.length, 1);
  } finally {
    mocked.restore();
  }
});

test("buildRevertBranchName keeps identities distinct when sanitized names collide", () => {
  // `release/2.x` and `release-2.x` sanitize to the same string; the digest
  // suffix must keep their revert refs apart so one branch's leftover ref can
  // never be force-repointed by the other's retry.
  const slashed = buildRevertBranchName(FAILING_SHA, "release/2.x");
  const dashed = buildRevertBranchName(FAILING_SHA, "release-2.x");
  assert.notEqual(slashed, dashed);
  assert.ok(slashed.startsWith(`mogplex/revert-${FAILING_SHA.slice(0, 12)}-`));
  // Same inputs always produce the same identity — retries must converge.
  assert.equal(slashed, buildRevertBranchName(FAILING_SHA, "release/2.x"));
});

test("createRevertPr URL-encodes branches with URL-significant characters", async () => {
  const tools = buildCITools({
    githubToken: "token",
    owner: "acme",
    repo: "widgets",
    revert: { failingSha: FAILING_SHA, branch: "feature/#123" },
  });

  const mocked = mockFetch((url, init) => {
    if (url.includes("/pulls?head=")) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (url.endsWith("/git/ref/heads/feature/%23123")) {
      return new Response(JSON.stringify({ object: { sha: FAILING_SHA } }), {
        status: 200,
      });
    }
    if (url.endsWith(`/git/commits/${FAILING_SHA}`)) {
      return new Response(
        JSON.stringify({
          message: "feat: bad",
          parents: [{ sha: PARENT_SHA }],
        }),
        { status: 200 }
      );
    }
    if (url.endsWith(`/git/commits/${PARENT_SHA}`)) {
      return new Response(JSON.stringify({ tree: { sha: "t" } }), {
        status: 200,
      });
    }
    if (url.endsWith("/git/commits") && init?.method === "POST") {
      return new Response(JSON.stringify({ sha: "revertsha" }), {
        status: 201,
      });
    }
    if (url.endsWith("/git/refs") && init?.method === "POST") {
      return new Response(JSON.stringify({}), { status: 201 });
    }
    if (url.endsWith("/pulls") && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as { base: string };
      assert.equal(body.base, "feature/#123");
      return new Response(
        JSON.stringify({ number: 94, html_url: "https://github.com/pr/94" }),
        { status: 201 }
      );
    }
    return new Response("unexpected", { status: 500 });
  });
  try {
    const result = (await (
      (tools as Record<string, unknown>).createRevertPr as ToolLike
    ).execute({ reason: "r" })) as { success: boolean };
    assert.equal(result.success, true);
    // The raw `#` never reached a request path where it would be parsed as a
    // URL fragment.
    const rawFragmentCall = mocked.calls.find((call) =>
      call.url.includes("/git/ref/heads/feature/#")
    );
    assert.equal(rawFragmentCall, undefined);
  } finally {
    mocked.restore();
  }
});

test("createRevertPr keeps per-branch revert identities for the same failing commit", async () => {
  const buildFor = (branch: string) =>
    buildCITools({
      githubToken: "token",
      owner: "acme",
      repo: "widgets",
      revert: { failingSha: FAILING_SHA, branch },
    });

  // A revert PR already exists for main. The release/2.x call must NOT reuse
  // it: its lookup is scoped to its own head+base, so it proceeds to create a
  // release-scoped branch and a PR based on release/2.x.
  const createdRefs: string[] = [];
  const mocked = mockFetch((url, init) => {
    if (url.includes("/pulls?head=")) {
      const parsed = new URL(url);
      const head = parsed.searchParams.get("head");
      const base = parsed.searchParams.get("base");
      if (
        head === `acme:${buildRevertBranchName(FAILING_SHA, "main")}` &&
        base === "main"
      ) {
        return new Response(
          JSON.stringify([
            {
              number: 90,
              html_url: "https://github.com/pr/90",
              base: { ref: "main" },
            },
          ]),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (url.includes("/git/ref/heads/")) {
      return new Response(JSON.stringify({ object: { sha: FAILING_SHA } }), {
        status: 200,
      });
    }
    if (url.endsWith(`/git/commits/${FAILING_SHA}`)) {
      return new Response(
        JSON.stringify({
          message: "feat: bad",
          parents: [{ sha: PARENT_SHA }],
        }),
        { status: 200 }
      );
    }
    if (url.endsWith(`/git/commits/${PARENT_SHA}`)) {
      return new Response(JSON.stringify({ tree: { sha: "t" } }), {
        status: 200,
      });
    }
    if (url.endsWith("/git/commits") && init?.method === "POST") {
      return new Response(JSON.stringify({ sha: "revertsha" }), {
        status: 201,
      });
    }
    if (url.endsWith("/git/refs") && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as { ref: string };
      createdRefs.push(body.ref);
      return new Response(JSON.stringify({}), { status: 201 });
    }
    if (url.endsWith("/pulls") && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as { base: string };
      assert.equal(body.base, "release/2.x");
      return new Response(
        JSON.stringify({ number: 93, html_url: "https://github.com/pr/93" }),
        { status: 201 }
      );
    }
    return new Response("unexpected", { status: 500 });
  });
  try {
    const mainResult = await (
      (buildFor("main") as Record<string, unknown>).createRevertPr as ToolLike
    ).execute({ reason: "r" });
    assert.deepEqual(mainResult, {
      success: true,
      pr_number: 90,
      url: "https://github.com/pr/90",
      reused: true,
    });

    const releaseResult = (await (
      (buildFor("release/2.x") as Record<string, unknown>)
        .createRevertPr as ToolLike
    ).execute({ reason: "r" })) as { success: boolean; pr_number: number };
    assert.equal(releaseResult.success, true);
    assert.equal(releaseResult.pr_number, 93);
    assert.deepEqual(createdRefs, [
      `refs/heads/${buildRevertBranchName(FAILING_SHA, "release/2.x")}`,
    ]);
  } finally {
    mocked.restore();
  }
});

function raceMockHandlers(input: {
  lookupResponses: Array<Array<Record<string, unknown>>>;
  refCreateStatus: number;
  prCreateStatus: number;
  revertBranchRefSha?: string;
  revertBranchRefStatus?: number;
}) {
  let lookupCall = 0;
  const events: string[] = [];
  const handler = (url: string, init?: RequestInit) => {
    if (url.includes("/pulls?head=")) {
      const body = input.lookupResponses[lookupCall] ?? [];
      lookupCall += 1;
      return new Response(JSON.stringify(body), { status: 200 });
    }
    if (url.endsWith("/git/ref/heads/main")) {
      return new Response(JSON.stringify({ object: { sha: FAILING_SHA } }), {
        status: 200,
      });
    }
    if (!init?.method && url.includes("/git/ref/heads/mogplex/revert-")) {
      const status = input.revertBranchRefStatus ?? 200;
      if (status !== 200) {
        return new Response("missing", { status });
      }
      return new Response(
        JSON.stringify({
          object: { sha: input.revertBranchRefSha ?? "revertsha" },
        }),
        { status: 200 }
      );
    }
    if (url.endsWith(`/git/commits/${FAILING_SHA}`)) {
      return new Response(
        JSON.stringify({
          message: "feat: bad",
          parents: [{ sha: PARENT_SHA }],
        }),
        { status: 200 }
      );
    }
    if (url.endsWith(`/git/commits/${PARENT_SHA}`)) {
      return new Response(JSON.stringify({ tree: { sha: "t" } }), {
        status: 200,
      });
    }
    if (url.endsWith("/git/commits") && init?.method === "POST") {
      return new Response(JSON.stringify({ sha: "revertsha" }), {
        status: 201,
      });
    }
    if (url.endsWith("/git/refs") && init?.method === "POST") {
      return new Response(
        input.refCreateStatus === 201 ? JSON.stringify({}) : "exists",
        { status: input.refCreateStatus }
      );
    }
    if (init?.method === "PATCH" && url.includes("/git/refs/heads/")) {
      events.push("patch");
      return new Response(JSON.stringify({}), { status: 200 });
    }
    if (init?.method === "DELETE" && url.includes("/git/refs/heads/")) {
      events.push("delete");
      return new Response(null, { status: 204 });
    }
    if (url.endsWith("/pulls") && init?.method === "POST") {
      return new Response(
        input.prCreateStatus === 201
          ? JSON.stringify({ number: 99, html_url: "https://github.com/pr/99" })
          : "exists",
        { status: input.prCreateStatus }
      );
    }
    return new Response("unexpected", { status: 500 });
  };
  return { handler, events };
}

const RACE_REVERT = {
  githubToken: "token",
  owner: "acme",
  repo: "widgets",
  revert: { failingSha: FAILING_SHA, branch: "main" },
};

test("createRevertPr reuses the winner's PR instead of deleting the shared ref after losing a PR race", async () => {
  // Delivery B repointed the ref and opened PR #95 between this call's ref
  // creation and its PR POST. The 422 on the PR POST must resolve to reuse,
  // never to a DELETE that would orphan #95's head branch.
  const { handler, events } = raceMockHandlers({
    lookupResponses: [
      [],
      [
        {
          number: 95,
          html_url: "https://github.com/pr/95",
          base: { ref: "main" },
        },
      ],
    ],
    refCreateStatus: 201,
    prCreateStatus: 422,
  });
  const mocked = mockFetch(handler);
  try {
    const result = await (
      (buildCITools(RACE_REVERT) as Record<string, unknown>)
        .createRevertPr as ToolLike
    ).execute({ reason: "r" });
    assert.deepEqual(result, {
      success: true,
      pr_number: 95,
      url: "https://github.com/pr/95",
      reused: true,
    });
    assert.deepEqual(events, []);
  } finally {
    mocked.restore();
  }
});

test("createRevertPr skips cleanup when the ref no longer points at this call's commit", async () => {
  // PR creation failed and no PR is visible yet, but the ref was repointed by
  // a concurrent delivery (different SHA). This call no longer owns it, so it
  // must not delete it.
  const { handler, events } = raceMockHandlers({
    lookupResponses: [[], []],
    refCreateStatus: 201,
    prCreateStatus: 502,
    revertBranchRefSha: "someone-elses-commit",
  });
  const mocked = mockFetch(handler);
  try {
    const result = (await (
      (buildCITools(RACE_REVERT) as Record<string, unknown>)
        .createRevertPr as ToolLike
    ).execute({ reason: "r" })) as { success: boolean };
    assert.equal(result.success, false);
    assert.deepEqual(events, []);
  } finally {
    mocked.restore();
  }
});

test("createRevertPr reuses a PR discovered on the ref-collision path instead of repointing", async () => {
  // The ref already exists and, by the time this call re-checks, its PR is
  // open — a concurrent delivery finished first. Repointing would hijack that
  // PR's head; the call must reuse it.
  const { handler, events } = raceMockHandlers({
    lookupResponses: [
      [],
      [
        {
          number: 96,
          html_url: "https://github.com/pr/96",
          base: { ref: "main" },
        },
      ],
    ],
    refCreateStatus: 422,
    prCreateStatus: 201,
  });
  const mocked = mockFetch(handler);
  try {
    const result = await (
      (buildCITools(RACE_REVERT) as Record<string, unknown>)
        .createRevertPr as ToolLike
    ).execute({ reason: "r" });
    assert.deepEqual(result, {
      success: true,
      pr_number: 96,
      url: "https://github.com/pr/96",
      reused: true,
    });
    assert.deepEqual(events, []);
  } finally {
    mocked.restore();
  }
});

test("buildRevertBranchName keeps the ref leaf component under git's length limit", () => {
  // A branch can be valid (each component under the limit) while a naive
  // concatenation into one leaf component is not.
  const longBranch = `release/${"x".repeat(240)}`;
  const name = buildRevertBranchName(FAILING_SHA, longBranch);
  const leaf = name.split("/").pop() ?? "";
  assert.ok(
    leaf.length <= 255,
    `leaf component is ${leaf.length} chars, over the 255 limit`
  );
  // Truncation must not merge identities: branches differing only past the
  // truncation point still get distinct refs via the digest.
  const longerBranch = `${longBranch}y`;
  assert.notEqual(name, buildRevertBranchName(FAILING_SHA, longerBranch));
});

test("createRevertPr reports an invalid ref name instead of patching a missing branch", async () => {
  // GitHub also returns 422 when it rejects the ref name itself. With no
  // existing branch to reuse or repoint, the call must surface the creation
  // failure rather than attempt a PATCH that can only 404.
  const { handler, events } = raceMockHandlers({
    lookupResponses: [[], []],
    refCreateStatus: 422,
    prCreateStatus: 201,
    revertBranchRefStatus: 404,
  });
  const mocked = mockFetch(handler);
  try {
    const result = (await (
      (buildCITools(RACE_REVERT) as Record<string, unknown>)
        .createRevertPr as ToolLike
    ).execute({ reason: "r" })) as { success: boolean; error?: string };
    assert.equal(result.success, false);
    assert.ok(result.error?.includes("rejected as invalid"));
    assert.deepEqual(events, []);
  } finally {
    mocked.restore();
  }
});
