import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { createMCPClient } from "@ai-sdk/mcp";
import {
  buildHarnessResearchEnv,
  codexResearchArgs,
  verifyResearchToken,
} from "../../lib/harness/research-auth";
import { createMogplexMcpPost } from "../../lib/harness/mogplex-mcp";
import { webFetch, webSearch } from "../../lib/agents/tools/web";
import { ALL_CAPABILITIES } from "../../lib/team-capabilities";
import { isPublicRoutePath } from "../../lib/auth-route-policy";
import { withEnv, withPatchedFetch } from "./helpers/agents-tools-fixtures";

const env = {
  EXA_API_KEY: "private-exa-key",
  EXA_RESEARCH_SECRET: "internal-signing-secret",
  NEXT_PUBLIC_APP_URL: "https://mogplex.com",
};
const context = { userId: "user-1", aiCallId: "call-1", id: "sandbox-1" };
const run = {
  userId: "user-1",
  aiCallId: "call-1",
  sandboxRecordId: "sandbox-1",
  repoId: "repo-1",
  teamId: null,
  conversationId: null,
};
const authorized = async () => ({ run, capabilities: ALL_CAPABILITIES });
const webTools = async () => ({
  tools: { web_search: webSearch, web_fetch: webFetch },
  cleanup: async () => undefined,
});

test("a real MCP HTTP client discovers and calls the harness research service", async () => {
  await withEnv(env, async () => {
    const post = createMogplexMcpPost({
      authorizeRun: authorized,
      buildTools: webTools,
    });
    const server = createServer(async (incoming, outgoing) => {
      if (incoming.method !== "POST") {
        outgoing.writeHead(405);
        outgoing.end();
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
      const response = await post(
        new Request("http://localhost/mcp", {
          method: "POST",
          headers: { authorization: incoming.headers.authorization ?? "" },
          body: Buffer.concat(chunks).toString(),
        })
      );
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(await response.text());
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const actualFetch = globalThis.fetch;
    try {
      await withPatchedFetch(
        async (input, init) =>
          String(input) === "https://api.exa.ai/search"
            ? Response.json({
                results: [
                  {
                    url: "https://example.com/api",
                    highlights: ["API documentation"],
                  },
                ],
              })
            : actualFetch(input, init),
        async () => {
          const client = await createMCPClient({
            transport: {
              type: "http",
              url: `http://127.0.0.1:${address.port}/mcp`,
              headers: {
                Authorization: `Bearer ${buildHarnessResearchEnv(context).MOGPLEX_RESEARCH_TOKEN}`,
              },
            },
          });
          try {
            const discovered = await client.tools();
            assert.ok(discovered.web_search);
            assert.ok(discovered.web_fetch);
            const output = await discovered.web_search.execute!(
              { query: "official API documentation" },
              { toolCallId: "test", messages: [], context: {} }
            );
            assert.match(JSON.stringify(output), /https:\/\/example.com\/api/);
            assert.match(JSON.stringify(output), /API documentation/);
          } finally {
            await client.close();
          }
        }
      );
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });
});

test("harness credentials are run scoped and never include the platform key", async () => {
  await withEnv(env, async () => {
    const runtime = buildHarnessResearchEnv(context);
    const token = runtime.MOGPLEX_RESEARCH_TOKEN;
    assert.equal(verifyResearchToken(token)?.aiCallId, "call-1");
    assert.equal(verifyResearchToken(token)?.sandboxRecordId, "sandbox-1");
    assert.equal(verifyResearchToken(token)?.userId, "user-1");
    assert.equal(
      runtime.MOGPLEX_RESEARCH_MCP_URL,
      "https://mogplex.com/api/harness-research/mcp"
    );
    assert.ok(!JSON.stringify(runtime).includes(env.EXA_API_KEY));
    assert.ok(!JSON.stringify(runtime).includes(env.EXA_RESEARCH_SECRET));
    assert.equal(verifyResearchToken(`${token}x`), null);
    assert.equal(verifyResearchToken(`altered.${token.split(".")[1]}`), null);
    const args = codexResearchArgs(runtime).join(" ");
    assert.match(args, /bearer_token_env_var/);
    assert.ok(!args.includes(token));
    assert.deepEqual(codexResearchArgs({}), []);
  });
  await withEnv({ EXA_API_KEY: undefined }, async () =>
    assert.deepEqual(buildHarnessResearchEnv(context), {})
  );
});

test("research MCP rejects missing or invalid credentials before run lookup", async () => {
  await withEnv(env, async () => {
    const post = createMogplexMcpPost({
      authorizeRun: async () => {
        throw new Error("must not reach lookup");
      },
    });
    for (const authorization of ["", "Bearer invalid"]) {
      const result = await post(
        new Request("https://mogplex.com/api/harness-research/mcp", {
          method: "POST",
          headers: { authorization },
          body: "{}",
        })
      );
      assert.equal(result.status, 401);
    }
    assert.equal(isPublicRoutePath("/api/harness-research/mcp"), true);
    assert.equal(isPublicRoutePath("/api/harness-research/mcp/extra"), false);
  });
});

test("research MCP rechecks run authorization and refuses inactive runs", async () => {
  await withEnv(env, async () => {
    const { MOGPLEX_RESEARCH_TOKEN: token } = buildHarnessResearchEnv(context);
    const post = createMogplexMcpPost({
      authorizeRun: async (claims) => {
        assert.equal(claims.userId, "user-1");
        return null;
      },
    });
    const response = await post(
      new Request("https://mogplex.com/api/harness-research/mcp", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      })
    );
    assert.equal(response.status, 403);
  });
});

test("research MCP executes search through Exa and returns citations to harnesses", async () => {
  await withEnv(env, () =>
    withPatchedFetch(
      async () =>
        Response.json({
          results: [
            {
              url: "https://example.com/docs",
              title: "API",
              highlights: ["Verified API example"],
            },
          ],
        }),
      async () => {
        const { MOGPLEX_RESEARCH_TOKEN: token } =
          buildHarnessResearchEnv(context);
        const post = createMogplexMcpPost({
          authorizeRun: authorized,
          buildTools: webTools,
        });
        const call = async (
          method: string,
          params?: Record<string, unknown>
        ) => {
          const response = await post(
            new Request("https://mogplex.com/api/harness-research/mcp", {
              method: "POST",
              headers: { authorization: `Bearer ${token}` },
              body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
            })
          );
          return response.json();
        };
        assert.equal(
          (await call("initialize")).result.serverInfo.name,
          "mogplex"
        );
        assert.deepEqual(
          (await call("tools/list")).result.tools.map(
            (t: { name: string }) => t.name
          ),
          ["web_search", "web_fetch"]
        );
        const result = (
          await call("tools/call", {
            name: "web_search",
            arguments: { query: "official docs" },
          })
        ).result;
        assert.equal(result.isError, false);
        assert.equal(
          JSON.parse(result.content[0].text).results[0].url,
          "https://example.com/docs"
        );
        assert.equal(
          (
            await call("tools/call", {
              name: "web_search",
              arguments: { query: "" },
            })
          ).error.code,
          -32602
        );
        assert.equal(
          (await call("tools/call", { name: "run_command", arguments: {} }))
            .error.code,
          -32602
        );
        // A tool the run's capabilities leave out is not there to call.
        const deniedPost = createMogplexMcpPost({
          authorizeRun: authorized,
          buildTools: async () => ({
            tools: {},
            cleanup: async () => undefined,
          }),
        });
        const denied = await deniedPost(
          new Request("https://mogplex.com/api/harness-research/mcp", {
            method: "POST",
            headers: { authorization: `Bearer ${token}` },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "tools/call",
              params: { name: "web_search", arguments: { query: "docs" } },
            }),
          })
        );
        assert.equal((await denied.json()).error.code, -32602);
      }
    )
  );
});

test("the Mogplex MCP serves the run's native tools and marks only read-only ones", async () => {
  await withEnv(env, async () => {
    const { MOGPLEX_RESEARCH_TOKEN: token } = buildHarnessResearchEnv(context);
    const { z } = await import("zod");
    const builds: Array<{ run: unknown; capabilities: unknown }> = [];
    let cleanups = 0;
    const addMemory = {
      description: "Save a memory",
      inputSchema: z.object({ content: z.string() }),
      execute: async (input: { content: string }) => ({ saved: input.content }),
    };
    const post = createMogplexMcpPost({
      authorizeRun: authorized,
      buildTools: async (buildRun, capabilities) => {
        builds.push({ run: buildRun, capabilities });
        return {
          tools: { web_search: webSearch, add_memory: addMemory } as never,
          cleanup: async () => {
            cleanups += 1;
          },
        };
      },
    });
    const call = async (method: string, params?: Record<string, unknown>) =>
      (
        await post(
          new Request("https://mogplex.com/api/harness-research/mcp", {
            method: "POST",
            headers: { authorization: `Bearer ${token}` },
            body: JSON.stringify({ jsonrpc: "2.0", id: 7, method, params }),
          })
        )
      ).json();

    const listed = (await call("tools/list")).result.tools as Array<{
      name: string;
      annotations?: { readOnlyHint?: boolean };
    }>;
    assert.deepEqual(
      listed.map((entry) => [entry.name, entry.annotations?.readOnlyHint]),
      [
        ["web_search", true],
        ["add_memory", undefined],
      ]
    );

    const saved = (
      await call("tools/call", {
        name: "add_memory",
        arguments: { content: "Deploys go through the merge queue" },
      })
    ).result;
    assert.equal(saved.isError, false);
    assert.deepEqual(JSON.parse(saved.content[0].text), {
      saved: "Deploys go through the merge queue",
    });
    assert.equal(
      (await call("tools/call", { name: "add_memory", arguments: {} })).error
        .code,
      -32602
    );

    assert.deepEqual(builds[0], { run, capabilities: ALL_CAPABILITIES });
    assert.equal(cleanups, builds.length, "every build is cleaned up");
    assert.equal((await call("initialize")).result.serverInfo.name, "mogplex");
    assert.equal(builds.length, 3, "initialize builds no tools");
  });
});
