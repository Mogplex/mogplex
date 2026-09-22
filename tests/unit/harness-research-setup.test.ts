import assert from "node:assert/strict";
import test from "node:test";
import { withEnv } from "./helpers/agents-tools-fixtures";
import { verifyResearchToken } from "../../lib/harness/research-auth";
import type { SandboxSetupContext } from "../../app/api/sandbox/[id]/harness/_lib/setup";

const context: SandboxSetupContext = {
  id: "sandbox-1",
  userId: "user-1",
  aiCallId: "call-1",
  teamId: null,
  harnessId: "claude-code",
  conversationId: null,
  repoId: null,
  rootDirectory: null,
  sandboxId: "provider-sandbox-1",
  baseBranch: "main",
  workingBranch: "main",
  previewUrl: null,
};

test("sandbox environment and Claude MCP reuse one research credential across setup steps", async (t) => {
  await withEnv(
    {
      EXA_RESEARCH_SECRET: "test-research-secret",
      NEXT_PUBLIC_APP_URL: "https://mogplex.com",
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
    },
    async () => {
      const { setupSandboxEnv, setupMcpConfig } =
        await import("../../app/api/sandbox/[id]/harness/_lib/setup");
      const { resolveRepoSandboxEnv } =
        await import("../../lib/vercel/env-vars");
      const { injectClaudeMcpConfig } =
        await import("../../lib/harness/mcp-config");
      let now = 1_800_000_000_000;
      t.mock.method(Date, "now", () => now);
      const { runtimeEnv } = await setupSandboxEnv(
        {
          resolveRepoSandboxEnv,
          getGithubAccessTokenForRepo: async () => null,
        },
        context,
        {
          env: { ANTHROPIC_API_KEY: "test-provider-key" },
          aiBillingSource: "platform",
        },
        null
      );
      const token = runtimeEnv.MOGPLEX_RESEARCH_TOKEN;
      const claims = verifyResearchToken(token);
      assert.equal(claims?.aiCallId, context.aiCallId);
      now += 60_000;
      const files = new Map<string, Buffer>();
      const sandbox = {
        readFile: async () => undefined,
        writeFiles: async (
          entries: Array<{ path: string; content: Buffer }>
        ) => {
          for (const entry of entries) files.set(entry.path, entry.content);
        },
      } as unknown as Parameters<typeof setupMcpConfig>[1];
      await setupMcpConfig(
        {
          injectClaudeMcpConfig,
          getResolvedConnections: async () => [],
          safeAppendAiCallEvent: async () => {},
        },
        sandbox,
        context,
        runtimeEnv
      );
      const config = files.get(".mogplex/mcp.json")?.toString();
      assert.ok(config);
      const server = JSON.parse(config).mcpServers.mogplex_research;
      assert.equal(server.headers.Authorization, `Bearer ${token}`);
      assert.equal(server.url, runtimeEnv.MOGPLEX_RESEARCH_MCP_URL);
      assert.equal(
        verifyResearchToken(server.headers.Authorization.slice(7))?.expiresAt,
        claims?.expiresAt
      );
      assert.ok(!config.includes("test-provider-key"));
    }
  );
});
