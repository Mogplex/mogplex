import assert from "node:assert/strict";
import test from "node:test";
import { buildCITools } from "../../lib/agents/ci-tools";
import {
  mockFetch,
  leftoverBranchMock,
  FAILING_SHA,
  PARENT_SHA,
  buildRevertBranchName,
  type ToolLike,
} from "./helpers/ci-revert-tool-fixtures";

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

test("buildRevertBranchName keeps identities distinct when sanitized names collide", () => {
  // `release/2.x` and `release-2.x` sanitize to the same string; the digest
  // suffix must keep their revert refs apart so one branch's leftover ref can
  // never be force-repointed by the other's retry.
  const slashed = buildRevertBranchName(FAILING_SHA, "release/2.x");
  const dashed = buildRevertBranchName(FAILING_SHA, "release-2.x");
  assert.notEqual(slashed, dashed);
  assert.ok(slashed.startsWith(`mogplex/revert-${FAILING_SHA.slice(0, 12)}-`));
  // Same inputs always produce the same identity - retries must converge.
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
