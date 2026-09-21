import assert from "node:assert/strict";
import test from "node:test";
import {
  withEnv,
  withPatchedFetch,
  loadToolsModule,
} from "./helpers/agents-tools-fixtures";
import { webFetch, webSearch } from "../../lib/agents/tools/web";

type ResearchResult = {
  error?: string;
  provider?: string;
  query?: string;
  content?: string;
  url?: string;
  possiblyTruncated?: boolean;
  results?: Array<{
    title: string;
    url: string;
    snippet: string;
    publishedDate?: string;
  }>;
};
type Executable = {
  execute: (
    input: unknown,
    options?: { abortSignal?: AbortSignal }
  ) => Promise<ResearchResult>;
};
const search = webSearch as unknown as Executable;
const fetchPage = webFetch as unknown as Executable;
const source = {
  title: "Official API",
  url: "https://example.com/api",
  highlights: ["Use search(query)."],
  publishedDate: "2026-09-21",
};

test("search returns Exa excerpts and citations with minimal default retrieval", async () => {
  await withEnv({ EXA_API_KEY: "test-exa-key" }, () =>
    withPatchedFetch(
      async (url, init) => {
        assert.equal(String(url), "https://api.exa.ai/search");
        assert.equal(
          new Headers(init?.headers).get("x-api-key"),
          "test-exa-key"
        );
        assert.deepEqual(JSON.parse(String(init?.body)), {
          query: "official API docs",
          type: "auto",
          contents: { highlights: true },
        });
        return Response.json({ results: [source], requestId: "request-1" });
      },
      async () => {
        const result = await search.execute({ query: " official API docs " });
        assert.equal(result.provider, "exa");
        assert.equal(result.query, "official API docs");
        assert.deepEqual(result.results, [
          {
            title: source.title,
            url: source.url,
            snippet: "Use search(query).",
            publishedDate: source.publishedDate,
            author: undefined,
          },
        ]);
        assert.ok(!JSON.stringify(result).includes("test-exa-key"));
      }
    )
  );
});

test("search honors an explicit limit and distinguishes zero matches from failure", async () => {
  await withEnv({ EXA_API_KEY: "test-exa-key" }, () =>
    withPatchedFetch(
      async (_url, init) => {
        assert.equal(JSON.parse(String(init?.body)).numResults, 2);
        return Response.json({ results: [] });
      },
      async () => {
        const result = await search.execute({
          query: "rare documentation",
          limit: 2,
        });
        assert.deepEqual(result.results, []);
        assert.equal(result.error, undefined);
      }
    )
  );
});

test("invalid research inputs never reach the provider", async () => {
  await withPatchedFetch(
    async () => {
      throw new Error("unexpected network request");
    },
    async () => {
      for (const input of [
        { query: " " },
        { query: "docs", limit: 0 },
        { query: "docs", limit: 1.5 },
        { query: "docs", limit: 26 },
      ]) {
        await assert.rejects(() => search.execute(input));
      }
      await assert.rejects(
        () => fetchPage.execute({ url: "http://localhost/secret" }),
        /public host/
      );
      await assert.rejects(() =>
        fetchPage.execute({ url: "https://example.com", maxCharacters: -1 })
      );
    }
  );
});

test("missing Exa credentials produce an actionable error without a request", async () => {
  await withEnv(
    { EXA_API_KEY: undefined, EXA_RESEARCH_SECRET: undefined },
    () =>
      withPatchedFetch(
        async () => {
          throw new Error("unexpected request");
        },
        async () => {
          assert.match(
            (await search.execute({ query: "docs" })).error!,
            /EXA_API_KEY/
          );
        }
      )
  );
});

test("provider authentication and rate-limit failures never leak response bodies", async () => {
  for (const status of [401, 429, 500]) {
    await withEnv({ EXA_API_KEY: "test-exa-key" }, () =>
      withPatchedFetch(
        async () => new Response("secret-provider-body", { status }),
        async () => {
          const result = await search.execute({ query: "docs" });
          assert.match(result.error!, new RegExp(`HTTP ${status}`));
          assert.ok(!JSON.stringify(result).includes("secret-provider-body"));
          assert.equal(result.results, undefined);
        }
      )
    );
  }
});

test("invalid responses and interrupted requests are errors, not empty search results", async () => {
  await withEnv({ EXA_API_KEY: "test-exa-key" }, async () => {
    for (const body of [{ results: [{}] }, { invalid: true }]) {
      await withPatchedFetch(
        async () => Response.json(body),
        async () => {
          assert.match(
            (await search.execute({ query: "docs" })).error!,
            /invalid response/
          );
        }
      );
    }
    const abortSignal = AbortSignal.abort();
    await withPatchedFetch(
      async (_url, init) => {
        assert.equal(init?.signal?.aborted, true);
        throw new Error("private network detail");
      },
      async () => {
        assert.match(
          (await search.execute({ query: "docs" }, { abortSignal })).error!,
          /cancelled/
        );
      }
    );
  });
});

test("page fetch returns clean text and preserves source with explicit freshness", async () => {
  const url = "https://1.1.1.1/docs";
  await withEnv({ EXA_API_KEY: "test-exa-key" }, () =>
    withPatchedFetch(
      async (target, init) => {
        assert.equal(String(target), "https://api.exa.ai/contents");
        assert.deepEqual(JSON.parse(String(init?.body)), {
          urls: [url],
          text: { maxCharacters: 1000 },
          maxAgeHours: 0,
        });
        return Response.json({
          results: [{ url, title: "Docs", text: "x".repeat(1001) }],
          statuses: [{ id: url, status: "success" }],
        });
      },
      async () => {
        const result = await fetchPage.execute({
          url,
          maxCharacters: 1000,
          maxAgeHours: 0,
        });
        assert.equal(result.content?.length, 1000);
        assert.equal(result.possiblyTruncated, true);
        assert.equal(result.url, url);
        assert.equal(result.provider, "exa");
      }
    )
  );
});

test("page failures inside HTTP 200 and missing text do not look successful", async () => {
  const url = "https://1.1.1.1/docs";
  for (const body of [
    {
      results: [{ url, text: "partial" }],
      statuses: [{ id: url, status: "error" }],
    },
    { results: [] },
    { results: [{ url }] },
  ]) {
    await withEnv({ EXA_API_KEY: "test-exa-key" }, () =>
      withPatchedFetch(
        async () => Response.json(body),
        async () => {
          const result = await fetchPage.execute({ url });
          assert.ok(result.error);
          assert.equal(result.content, undefined);
        }
      )
    );
  }
});

test("shared native and Control agent tools can execute Exa search", async () => {
  const { buildStaticTools } = await loadToolsModule();
  const { buildOrchestratorTools } =
    await import("../../lib/agents/orchestrator/registry");
  const surfaces = [
    buildStaticTools(),
    buildOrchestratorTools({ userId: "user-1" }),
  ];
  await withEnv({ EXA_API_KEY: "test-exa-key" }, () =>
    withPatchedFetch(
      async () => Response.json({ results: [source] }),
      async () => {
        for (const tools of surfaces) {
          const result = await (
            tools.web_search as unknown as Executable
          ).execute({ query: "docs" });
          assert.equal(result.results?.[0].url, source.url);
          assert.equal(result.provider, "exa");
          assert.ok(tools.web_fetch);
        }
      }
    )
  );
});
