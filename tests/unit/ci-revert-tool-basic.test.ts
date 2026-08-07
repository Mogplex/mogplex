import assert from "node:assert/strict";
import test from "node:test";
import { buildCITools } from "../../lib/agents/ci-tools";
import {
  mockFetch,
  FAILING_SHA,
  PARENT_SHA,
  buildRevertBranchName,
  type ToolLike,
} from "./helpers/ci-revert-tool-fixtures";

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
    // Only the PR precheck and head check ran - no mutations were attempted.
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
    // The lookup was the only call - nothing was mutated on an unverified
    // "no existing PR" answer.
    assert.equal(mocked.calls.length, 1);
  } finally {
    mocked.restore();
  }
});
