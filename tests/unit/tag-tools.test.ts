import assert from "node:assert/strict";
import test from "node:test";
import { buildTagPushTools } from "../../lib/agents/tag-tools";

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

test("tag tools default file reads to the pushed tag ref", async () => {
  const tools = buildTagPushTools({
    githubToken: "token",
    owner: "acme",
    repo: "widgets",
    tagName: "v2.0.0",
  });

  const mocked = mockFetch(
    () =>
      new Response(
        JSON.stringify({
          name: "package.json",
          type: "file",
          content: Buffer.from('{"version":"2.0.0"}').toString("base64"),
        }),
        { status: 200 }
      )
  );
  try {
    const content = await (tools.fetchFile as unknown as ToolLike).execute({
      path: "package.json",
    });
    assert.equal(content, '{"version":"2.0.0"}');
    assert.ok(mocked.calls[0]?.url.includes("ref=v2.0.0"));

    await (tools.fetchFile as unknown as ToolLike).execute({
      path: "package.json",
      ref: "main",
    });
    assert.ok(mocked.calls[1]?.url.includes("ref=main"));
  } finally {
    mocked.restore();
  }
});

test("postCommitComment resolves the tag to its commit before posting", async () => {
  const tools = buildTagPushTools({
    githubToken: "token",
    owner: "acme",
    repo: "widgets",
    tagName: "v2.0.0",
  });

  const mocked = mockFetch((url) => {
    if (url === "https://api.github.com/repos/acme/widgets/commits/v2.0.0") {
      return new Response(JSON.stringify({ sha: "commitsha123" }), {
        status: 200,
      });
    }
    if (
      url ===
      "https://api.github.com/repos/acme/widgets/commits/commitsha123/comments"
    ) {
      return new Response(JSON.stringify({ id: 1 }), { status: 201 });
    }
    return new Response("not found", { status: 404 });
  });
  try {
    const result = await (
      tools.postCommitComment as unknown as ToolLike
    ).execute({ body: "Findings" });
    assert.deepEqual(result, { success: true });
    assert.equal(mocked.calls.length, 2);
    const postedBody = JSON.parse(String(mocked.calls[1]?.init?.body)) as {
      body: string;
    };
    assert.ok(postedBody.body.includes("Findings"));
  } finally {
    mocked.restore();
  }
});

test("postCommitComment uses an explicit sha without resolving the tag", async () => {
  const tools = buildTagPushTools({
    githubToken: "token",
    owner: "acme",
    repo: "widgets",
    tagName: "v2.0.0",
  });

  const mocked = mockFetch((url) => {
    if (
      url ===
      "https://api.github.com/repos/acme/widgets/commits/explicitsha/comments"
    ) {
      return new Response(JSON.stringify({ id: 2 }), { status: 201 });
    }
    return new Response("not found", { status: 404 });
  });
  try {
    const result = await (
      tools.postCommitComment as unknown as ToolLike
    ).execute({ body: "Findings", sha: "explicitsha" });
    assert.deepEqual(result, { success: true });
    assert.equal(mocked.calls.length, 1);
  } finally {
    mocked.restore();
  }
});

test("tag tools reject dot-segment paths and validate content responses", async () => {
  const tools = buildTagPushTools({
    githubToken: "token",
    owner: "acme",
    repo: "widgets",
    tagName: "v2.0.0",
  });

  const mocked = mockFetch(
    () => new Response(JSON.stringify({ sha: "x" }), { status: 200 })
  );
  try {
    await assert.rejects(
      (tools.fetchFile as unknown as ToolLike).execute({
        path: "../../../repos/other/secrets",
      }),
      /Invalid repository path/
    );
    assert.equal(mocked.calls.length, 0);
  } finally {
    mocked.restore();
  }

  // Directory responses come back as an array; return a message, not a throw.
  const dirMock = mockFetch(
    () =>
      new Response(JSON.stringify([{ name: "a.ts", type: "file" }]), {
        status: 200,
      })
  );
  try {
    const result = await (tools.fetchFile as unknown as ToolLike).execute({
      path: "src",
    });
    assert.ok(String(result).includes("is a directory"));
  } finally {
    dirMock.restore();
  }

  // Binary payloads are described, never decoded into model context.
  const binaryMock = mockFetch(
    () =>
      new Response(
        JSON.stringify({
          type: "file",
          encoding: "base64",
          content: Buffer.from([0, 1, 2, 3, 255, 254]).toString("base64"),
        }),
        { status: 200 }
      )
  );
  try {
    const result = await (tools.fetchFile as unknown as ToolLike).execute({
      path: "logo.png",
    });
    assert.ok(String(result).includes("Binary file omitted"));
  } finally {
    binaryMock.restore();
  }
});

test("tag tools truncate oversized files against the shared text budget", async () => {
  const tools = buildTagPushTools({
    githubToken: "token",
    owner: "acme",
    repo: "widgets",
    tagName: "v2.0.0",
  });

  const bigContent = "a".repeat(30_000);
  const mocked = mockFetch(
    () =>
      new Response(
        JSON.stringify({
          type: "file",
          encoding: "base64",
          content: Buffer.from(bigContent).toString("base64"),
        }),
        { status: 200 }
      )
  );
  try {
    const result = String(
      await (tools.fetchFile as unknown as ToolLike).execute({
        path: "big.txt",
      })
    );
    assert.ok(result.includes("[Truncated big.txt"));
    assert.ok(result.length < bigContent.length);
  } finally {
    mocked.restore();
  }
});
