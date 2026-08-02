import assert from "node:assert/strict";
import test from "node:test";
import { buildCITools } from "../../lib/agents/ci-tools";
import { buildCommentTools } from "../../lib/agents/comment-tools";
import { buildRefactorTools } from "../../lib/agents/refactor";

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

function fileResponse(content: Buffer) {
  return new Response(
    JSON.stringify({
      type: "file",
      encoding: "base64",
      content: content.toString("base64"),
    }),
    { status: 200 }
  );
}

test("ci-tools fetchFile validates and truncates like the PR review reader", async () => {
  const tools = buildCITools({
    githubToken: "token",
    owner: "acme",
    repo: "widgets",
  });
  const fetchFile = tools.fetchFile as unknown as ToolLike;

  const binaryMock = mockFetch(() =>
    fileResponse(Buffer.from([0, 1, 2, 255, 254]))
  );
  try {
    const result = await fetchFile.execute({ path: "logo.png" });
    assert.ok(String(result).includes("Binary file omitted"));
  } finally {
    binaryMock.restore();
  }

  const bigMock = mockFetch(() =>
    fileResponse(Buffer.from("a".repeat(30_000)))
  );
  try {
    const result = String(await fetchFile.execute({ path: "big.txt" }));
    assert.ok(result.includes("[Truncated big.txt"));
    assert.ok(result.length < 30_000);
  } finally {
    bigMock.restore();
  }
});

test("comment-tools fetchFile returns a message for directory responses", async () => {
  const tools = buildCommentTools({
    githubToken: "token",
    owner: "acme",
    repo: "widgets",
    issueNumber: 5,
  });
  const fetchFile = tools.fetchFile as unknown as ToolLike;

  const mocked = mockFetch(
    () =>
      new Response(JSON.stringify([{ name: "a.ts", type: "file" }]), {
        status: 200,
      })
  );
  try {
    const result = await fetchFile.execute({ path: "src" });
    assert.ok(String(result).includes("is a directory"));
  } finally {
    mocked.restore();
  }
});

test("refactor readFile refuses oversized files instead of truncating", async () => {
  const tools = buildRefactorTools({
    skillId: "general-refactor",
    githubToken: "token",
    owner: "acme",
    repo: "widgets",
    branch: "main",
  });
  const readFile = tools.readFile as unknown as ToolLike;

  const bigMock = mockFetch(() =>
    fileResponse(Buffer.from("a".repeat(30_000)))
  );
  try {
    const result = String(await readFile.execute({ path: "big.txt" }));
    assert.ok(result.includes("above the"));
    assert.ok(!result.includes("aaaaaaaaaa"));
  } finally {
    bigMock.restore();
  }

  const okMock = mockFetch(() => fileResponse(Buffer.from("const x = 1;\n")));
  try {
    const result = await readFile.execute({ path: "x.ts" });
    assert.equal(result, "const x = 1;\n");
  } finally {
    okMock.restore();
  }
});
