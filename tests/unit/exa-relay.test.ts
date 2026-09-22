import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "../../app/api/internal/exa/route";
import { requestExa } from "../../lib/agents/tools/exa";
import { isPublicRoutePath } from "../../lib/auth-route-policy";
import { withEnv, withPatchedFetch } from "./helpers/agents-tools-fixtures";

const search = {
  query: "official documentation",
  type: "auto",
  contents: { highlights: true },
};
const source = {
  url: "https://example.com/docs",
  highlights: ["Documentation"],
};
const env = {
  EXA_RESEARCH_SECRET: "relay-secret",
  EXA_API_KEY: "exa-secret",
  NEXT_PUBLIC_APP_URL: "https://mogplex.com",
};
function request(body: unknown, token = "relay-secret") {
  return new Request("https://mogplex.com/api/internal/exa", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

test("research relay authenticates before contacting Exa", async () => {
  assert.equal(isPublicRoutePath("/api/internal/exa"), true);
  await withEnv(env, () =>
    withPatchedFetch(
      async () => {
        throw new Error("unexpected request");
      },
      async () => {
        for (const token of ["", "wrong-secret"])
          assert.equal(
            (await POST(request({ endpoint: "search", body: search }, token)))
              .status,
            401
          );
        for (const body of [
          { endpoint: "answer", body: search },
          { endpoint: "search", body: { ...search, query: "" } },
          {
            endpoint: "contents",
            body: {
              urls: ["http://127.0.0.1/private"],
              text: { maxCharacters: 1000 },
            },
          },
        ])
          assert.equal((await POST(request(body))).status, 400);
      }
    )
  );
});

test("research relay executes the provider and returns citations without secrets", async () => {
  await withEnv(env, () =>
    withPatchedFetch(
      async (url, init) => {
        assert.equal(String(url), "https://api.exa.ai/search");
        assert.equal(new Headers(init?.headers).get("x-api-key"), "exa-secret");
        assert.deepEqual(JSON.parse(String(init?.body)), search);
        return Response.json({ results: [source] });
      },
      async () => {
        const response = await POST(
          request({ endpoint: "search", body: search })
        );
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.deepEqual(await response.json(), { results: [source] });
      }
    )
  );
});

test("workers relay write-only key placeholders without sending them as provider credentials", async () => {
  await withEnv({ ...env, EXA_API_KEY: "[SENSITIVE]" }, () =>
    withPatchedFetch(
      async (url, init) => {
        assert.equal(String(url), "https://mogplex.com/api/internal/exa");
        assert.equal(
          new Headers(init?.headers).get("authorization"),
          "Bearer relay-secret"
        );
        assert.equal(new Headers(init?.headers).get("x-api-key"), null);
        assert.deepEqual(JSON.parse(String(init?.body)), {
          endpoint: "search",
          body: search,
        });
        return Response.json({ results: [source] });
      },
      async () =>
        assert.deepEqual((await requestExa("search", search)).data?.results, [
          source,
        ])
    )
  );
});

test("relay cannot recurse without a real provider key or send secrets over HTTP", async () => {
  await withEnv({ ...env, EXA_API_KEY: "[SENSITIVE]" }, () =>
    withPatchedFetch(
      async () => {
        throw new Error("unexpected request");
      },
      async () => {
        assert.equal(
          (await POST(request({ endpoint: "search", body: search }))).status,
          503
        );
        await withEnv({ NEXT_PUBLIC_APP_URL: "http://example.com" }, async () =>
          assert.match((await requestExa("search", search)).error!, /HTTPS/)
        );
      }
    )
  );
});
