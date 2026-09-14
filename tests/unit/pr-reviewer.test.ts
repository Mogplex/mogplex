import assert from "node:assert/strict";
import test from "node:test";
import { zodSchema } from "ai";

async function loadPrReviewer() {
  return import("../../lib/agents/pr-reviewer");
}

type FetchFileExecutor = (input: {
  path: string;
  ref?: string;
  offset?: number;
}) => Promise<string>;

type ListChangedFilesExecutor = (input: { limit: number }) => Promise<{
  files: Array<{ path: string; patch: string | null }>;
}>;

function getFetchFileExecutor(tools: unknown): FetchFileExecutor {
  const execute = (
    tools as {
      fetchFile: {
        execute?: FetchFileExecutor;
      };
    }
  ).fetchFile.execute;

  assert.ok(execute);
  return execute;
}

function getListChangedFilesExecutor(tools: unknown): ListChangedFilesExecutor {
  const execute = (
    tools as {
      listChangedFiles: {
        execute?: ListChangedFilesExecutor;
      };
    }
  ).listChangedFiles.execute;

  assert.ok(execute);
  return execute;
}

test("buildPRReviewTools omits postComment by default", async () => {
  const { buildPRReviewTools } = await loadPrReviewer();
  const tools = buildPRReviewTools({
    githubToken: "github-token",
    owner: "acme",
    repo: "widgets",
    prNumber: 42,
  });

  assert.equal("postComment" in tools, false);
});

test("fetchFile omits binary content from the model context", async () => {
  const { buildPRReviewTools } = await loadPrReviewer();
  const originalFetch = globalThis.fetch;
  const pngBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 255]);

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        type: "file",
        encoding: "base64",
        size: pngBytes.length,
        content: pngBytes.toString("base64"),
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

  try {
    const tools = buildPRReviewTools({
      githubToken: "github-token",
      owner: "acme",
      repo: "widgets",
      prNumber: 42,
    });
    const result = await getFetchFileExecutor(tools)({
      path: "public/cover.png",
    });

    assert.match(result, /Binary file omitted from text review/);
    assert.match(result, /public\/cover\.png/);
    assert.match(result, /10 bytes/);
    assert.doesNotMatch(result, /�/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchFile describes content GitHub does not return inline", async () => {
  const { buildPRReviewTools } = await loadPrReviewer();
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        type: "file",
        encoding: "none",
        size: 2_000_000,
        content: "",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

  try {
    const tools = buildPRReviewTools({
      githubToken: "github-token",
      owner: "acme",
      repo: "widgets",
      prNumber: 42,
    });
    const result = await getFetchFileExecutor(tools)({
      path: "generated/catalog.json",
    });

    assert.match(result, /content unavailable for text review/i);
    assert.match(result, /generated\/catalog\.json/);
    assert.match(result, /2000000 bytes/);
    assert.match(result, /GitHub encoding: none/);
    assert.ok(result.length < 500);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchFile identifies directory responses from GitHub", async () => {
  const { buildPRReviewTools } = await loadPrReviewer();
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify([
        {
          type: "file",
          name: "widget.ts",
          path: "src/widget.ts",
        },
      ]),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

  try {
    const tools = buildPRReviewTools({
      githubToken: "github-token",
      owner: "acme",
      repo: "widgets",
      prNumber: 42,
    });
    const result = await getFetchFileExecutor(tools)({ path: "src" });

    assert.match(result, /src is a directory/);
    assert.match(result, /Fetch a specific file path/);
    assert.doesNotMatch(result, /encoding: unknown/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchFile bounds each response without exhausting later reads", async () => {
  const { buildPRReviewTools } = await loadPrReviewer();
  const originalFetch = globalThis.fetch;
  const largeText = "x".repeat(30_000);

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        type: "file",
        encoding: "base64",
        size: largeText.length,
        content: Buffer.from(largeText).toString("base64"),
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

  try {
    const tools = buildPRReviewTools({
      githubToken: "github-token",
      owner: "acme",
      repo: "widgets",
      prNumber: 42,
    });
    const fetchFile = getFetchFileExecutor(tools);

    for (const path of ["one.ts", "two.ts", "three.ts", "four.ts"]) {
      const result = await fetchFile({ path });
      assert.match(result, /offset=20000/);
      assert.ok(result.length < largeText.length);
    }

    const fifth = await fetchFile({ path: "five.ts" });
    assert.ok(fifth.startsWith("x".repeat(20_000)));
    assert.match(fifth, /offset=20000/);
    assert.equal(
      await fetchFile({ path: "five.ts", offset: 20_000 }),
      "x".repeat(10_000)
    );
    assert.ok(
      (await fetchFile({ path: "one.ts" })).startsWith("x".repeat(20_000))
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("listChangedFiles bounds patches per response without starving file reads", async () => {
  const { buildPRReviewTools } = await loadPrReviewer();
  const originalFetch = globalThis.fetch;
  const patch = `+${"x".repeat(3_999)}`;
  const largeText = "y".repeat(30_000);

  globalThis.fetch = async (input) => {
    const url = input.toString();
    const body = url.includes("/contents/")
      ? {
          type: "file",
          encoding: "base64",
          size: largeText.length,
          content: Buffer.from(largeText).toString("base64"),
        }
      : Array.from({ length: 30 }, (_, index) => ({
          filename: `src/file-${index}.ts`,
          status: "modified",
          additions: 1,
          deletions: 1,
          changes: 2,
          patch,
        }));

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const tools = buildPRReviewTools({
      githubToken: "github-token",
      owner: "acme",
      repo: "widgets",
      prNumber: 42,
    });
    const result = await getListChangedFilesExecutor(tools)({ limit: 100 });
    const fetchFile = getFetchFileExecutor(tools);
    const firstFile = await fetchFile({ path: "src/after-patches-1.ts" });
    const secondFile = await fetchFile({ path: "src/after-patches-2.ts" });
    const thirdFile = await fetchFile({ path: "src/after-patches-3.ts" });

    assert.ok(result.files.slice(0, 10).every((file) => file.patch === patch));
    assert.match(
      result.files[10]?.patch ?? "",
      /patch allocation .* exhausted.*fetchFile/i
    );
    assert.match(
      result.files.at(-1)?.patch ?? "",
      /patch allocation .* exhausted/i
    );
    for (const file of [firstFile, secondFile, thirdFile]) {
      assert.ok(file.startsWith("y".repeat(20_000)));
      assert.match(file, /offset=20000/);
    }
    assert.deepEqual(
      await getListChangedFilesExecutor(tools)({ limit: 100 }),
      result
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("postComment throws when GitHub rejects the review comment when enabled", async () => {
  const { buildPRReviewTools } = await loadPrReviewer();
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    new Response("permission denied", { status: 403 }) as Response;

  try {
    const tools = buildPRReviewTools({
      githubToken: "github-token",
      owner: "acme",
      repo: "widgets",
      prNumber: 42,
      allowPostComment: true,
    });
    const execute = (
      tools as unknown as {
        postComment: {
          execute?: (input: { body: string }) => Promise<{ success: boolean }>;
        };
      }
    ).postComment.execute;

    assert.ok(execute);

    await assert.rejects(
      async () => execute({ body: "Found an issue" }),
      /GitHub comment post failed \(403\)/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reportReview requires structured findings when hasIssues is true", async () => {
  const { buildPRReviewTools } = await loadPrReviewer();
  const tools = buildPRReviewTools({
    githubToken: "github-token",
    owner: "acme",
    repo: "widgets",
    prNumber: 42,
  });

  const schema = (tools.reportReview as { inputSchema: unknown })
    .inputSchema as {
    safeParse: (input: unknown) => { success: boolean };
  };

  assert.equal(
    schema.safeParse({
      hasIssues: true,
      summary: "Found an issue",
      commentBody: "Detailed explanation",
    }).success,
    false
  );
  assert.equal(
    schema.safeParse({
      hasIssues: true,
      summary: "Found an issue",
      commentBody: "Detailed explanation",
      findings: [
        {
          severity: "warning",
          title: "Guard nullable lookup",
          body: "The lookup can return undefined.",
          path: "src/widget.ts",
          line: 12,
        },
      ],
    }).success,
    true
  );
});

test("reportReview exposes a provider-safe root object schema", async () => {
  const { buildPRReviewTools } = await loadPrReviewer();
  const tools = buildPRReviewTools({
    githubToken: "github-token",
    owner: "acme",
    repo: "widgets",
    prNumber: 42,
  });

  const schema = (tools.reportReview as { inputSchema: unknown })
    .inputSchema as Parameters<typeof zodSchema>[0];
  const jsonSchema = zodSchema(schema).jsonSchema as {
    type?: string;
    properties?: Record<string, unknown>;
  };

  assert.equal(jsonSchema.type, "object");
  assert.ok(jsonSchema.properties);
  assert.ok("hasIssues" in jsonSchema.properties);
  assert.ok("findings" in jsonSchema.properties);
});
