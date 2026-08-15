import assert from "node:assert/strict";
import test from "node:test";
import type { Connection } from "@/lib/types";
import type * as McpConfigModule from "../../lib/harness/mcp-config";

async function loadMcpConfigModule(): Promise<typeof McpConfigModule> {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../lib/harness/mcp-config");
}

function makeConn(overrides: Partial<Connection>): Connection {
  return {
    id: "conn_1",
    user_id: "user_1",
    name: "Slack",
    type: "mcp_server",
    base_url: null,
    auth_type: "bearer",
    auth_header: null,
    mcp_transport: "http",
    mcp_url: "https://mcp.example.com/http",
    description: null,
    is_enabled: true,
    health_status: "unknown",
    scope: "global",
    repo_id: null,
    oauth_client_id: null,
    oauth_authorize_url: null,
    oauth_token_url: null,
    oauth_scopes: null,
    oauth_authorized_at: null,
    oauth_token_expires_at: null,
    source_preset: null,
    last_tested_at: null,
    last_test_error: null,
    last_test_http_status: null,
    last_test_tool_count: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

test("buildClaudeMcpConfig serializes mcp_server connections with auth headers", async () => {
  const { buildClaudeMcpConfig } = await loadMcpConfigModule();
  const conn = makeConn({ id: "a", name: "Slack" });
  const config = await buildClaudeMcpConfig([conn], async () => "secret-token");

  assert.deepEqual(Object.keys(config.mcpServers), ["slack"]);
  assert.equal(config.mcpServers.slack.type, "http");
  assert.equal(config.mcpServers.slack.url, "https://mcp.example.com/http");
  assert.equal(
    config.mcpServers.slack.headers.Authorization,
    "Bearer secret-token"
  );
});

test("buildClaudeMcpConfig uses sse transport when configured", async () => {
  const { buildClaudeMcpConfig } = await loadMcpConfigModule();
  const conn = makeConn({
    id: "a",
    name: "Linear",
    mcp_transport: "sse",
    mcp_url: "https://mcp.linear.app/sse",
  });
  const config = await buildClaudeMcpConfig([conn], async () => "tok");

  assert.equal(config.mcpServers.linear.type, "sse");
});

test("buildClaudeMcpConfig skips rest_api and misconfigured mcp connections", async () => {
  const { buildClaudeMcpConfig } = await loadMcpConfigModule();
  const rest = makeConn({ id: "a", name: "REST", type: "rest_api" });
  const badMcp = makeConn({
    id: "b",
    name: "NoUrl",
    mcp_url: null,
  });
  const goodMcp = makeConn({ id: "c", name: "OK" });

  const config = await buildClaudeMcpConfig(
    [rest, badMcp, goodMcp],
    async () => "tok"
  );

  assert.deepEqual(Object.keys(config.mcpServers), ["ok"]);
});

test("buildClaudeMcpConfig never resolves or transmits broker-era Sentry credentials", async () => {
  const { buildClaudeMcpConfig } = await loadMcpConfigModule();
  const legacySentry = makeConn({
    id: "legacy-sentry",
    name: "Sentry",
    source_preset: "sentry",
    mcp_url: "https://mcp.sentry.dev/mcp",
    auth_type: "bearer",
  });
  let credentialResolutionCount = 0;

  const config = await buildClaudeMcpConfig([legacySentry], async () => {
    credentialResolutionCount += 1;
    return JSON.stringify({ kind: ["pipe", "dream_connect"].join("") });
  });

  assert.deepEqual(config.mcpServers, {});
  assert.equal(credentialResolutionCount, 0);
});

test("buildClaudeMcpConfig disambiguates duplicate sanitized names", async () => {
  const { buildClaudeMcpConfig } = await loadMcpConfigModule();
  const a = makeConn({ id: "aaaaaaaa-1", name: "My Server" });
  const b = makeConn({ id: "bbbbbbbb-2", name: "my_server" });

  const config = await buildClaudeMcpConfig([a, b], async () => "tok");

  const keys = Object.keys(config.mcpServers);
  assert.equal(keys.length, 2);
  assert.ok(keys.includes("my_server"));
  assert.ok(keys.some((k) => k.startsWith("my_server_")));
});

test("buildClaudeMcpConfig tolerates per-connection credential failures", async () => {
  const { buildClaudeMcpConfig } = await loadMcpConfigModule();
  const good = makeConn({ id: "good", name: "Good" });
  const bad = makeConn({ id: "bad", name: "Bad" });

  const config = await buildClaudeMcpConfig([good, bad], async (conn) => {
    if (conn.id === "bad") throw new Error("vault unavailable");
    return "tok";
  });

  assert.deepEqual(Object.keys(config.mcpServers), ["good"]);
});

type WriteEntry = { path: string; content: Buffer };

function makeSandboxMock(
  opts: {
    existingFiles?: Record<string, string>;
    readFileOverride?: (args: { path: string }) => Promise<unknown>;
    writeFilesOverride?: (entries: WriteEntry[]) => Promise<void>;
  } = {}
) {
  const writes: WriteEntry[] = [];
  const existing = opts.existingFiles ?? {};
  const sandbox = {
    async readFile({ path }: { path: string }) {
      if (opts.readFileOverride) return opts.readFileOverride({ path });
      // Sandbox readFile contract: returns truthy buffer when present,
      // throws when absent. Mirror that here so ensureMogplexGitignore
      // exercises both its success and catch branches.
      if (path in existing) {
        return Buffer.from(existing[path]);
      }
      throw new Error(`ENOENT: ${path}`);
    },
    async writeFiles(entries: WriteEntry[]) {
      if (opts.writeFilesOverride) return opts.writeFilesOverride(entries);
      writes.push(...entries);
    },
  } as const;
  return { sandbox, writes };
}

test("writeClaudeMcpConfig writes under .mogplex/ in rootDirectory and returns CWD-relative path", async () => {
  const { writeClaudeMcpConfig, CLAUDE_MCP_CONFIG_FILENAME } =
    await loadMcpConfigModule();
  const { sandbox, writes } = makeSandboxMock();

  const flag = await writeClaudeMcpConfig(sandbox as never, "app", {
    mcpServers: {
      slack: {
        type: "http",
        url: "https://x/y",
        headers: { Authorization: "Bearer t" },
      },
    },
  });

  assert.equal(flag, CLAUDE_MCP_CONFIG_FILENAME);
  assert.equal(flag, ".mogplex/mcp.json");
  const gitignore = writes.find((w) => w.path === "app/.mogplex/.gitignore");
  const mcp = writes.find((w) => w.path === "app/.mogplex/mcp.json");
  assert.ok(gitignore, "expected seed write of .mogplex/.gitignore");
  assert.equal(gitignore.content.toString("utf8"), "*\n");
  assert.ok(mcp, "expected .mogplex/mcp.json write");
  const parsed = JSON.parse(mcp.content.toString("utf8"));
  assert.equal(parsed.mcpServers.slack.url, "https://x/y");
});

test("writeClaudeMcpConfig writes to bare .mogplex/mcp.json when rootDirectory is empty", async () => {
  const { writeClaudeMcpConfig } = await loadMcpConfigModule();
  const { sandbox, writes } = makeSandboxMock();

  await writeClaudeMcpConfig(sandbox as never, null, { mcpServers: {} });
  assert.ok(writes.some((w) => w.path === ".mogplex/mcp.json"));
  assert.ok(writes.some((w) => w.path === ".mogplex/.gitignore"));
});

test("writeClaudeMcpConfig overwrites with empty mcpServers to flush stale credentials", async () => {
  const { writeClaudeMcpConfig } = await loadMcpConfigModule();
  const { sandbox, writes } = makeSandboxMock();

  await writeClaudeMcpConfig(sandbox as never, "app", { mcpServers: {} });

  const mcp = writes.find((w) => w.path === "app/.mogplex/mcp.json");
  assert.ok(mcp, "expected mcp.json write");
  const parsed = JSON.parse(mcp.content.toString("utf8"));
  assert.deepEqual(parsed, { mcpServers: {} });
  assert.ok(writes.some((w) => w.path === "app/.mogplex/.gitignore"));
});

test("writeClaudeMcpConfig preserves a repo-owned .mogplex/.gitignore", async () => {
  const { writeClaudeMcpConfig } = await loadMcpConfigModule();
  const repoOwnedGitignore = "# custom\n!keep-me.txt\n";
  const { sandbox, writes } = makeSandboxMock({
    existingFiles: { "app/.mogplex/.gitignore": repoOwnedGitignore },
  });

  await writeClaudeMcpConfig(sandbox as never, "app", { mcpServers: {} });

  // Only mcp.json should be written — the existing gitignore is left alone.
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, "app/.mogplex/mcp.json");
  assert.ok(
    !writes.some((w) => w.path === "app/.mogplex/.gitignore"),
    "must not overwrite repo-owned .mogplex/.gitignore"
  );
});

test("writeClaudeMcpConfig seeds .mogplex/.gitignore when readFile throws", async () => {
  const { writeClaudeMcpConfig } = await loadMcpConfigModule();
  // Simulate an unreadable sandbox VFS — seed must still run to keep the guard.
  const { sandbox, writes } = makeSandboxMock({
    readFileOverride: async () => {
      throw new Error("sandbox read error");
    },
  });

  await writeClaudeMcpConfig(sandbox as never, "app", { mcpServers: {} });

  assert.ok(writes.some((w) => w.path === "app/.mogplex/.gitignore"));
  assert.ok(writes.some((w) => w.path === "app/.mogplex/mcp.json"));
});

test("injectClaudeMcpConfig writes resolved connections and returns server metadata", async () => {
  const { injectClaudeMcpConfig } = await loadMcpConfigModule();
  const { sandbox, writes } = makeSandboxMock();

  const conn = makeConn({ id: "c1", name: "Slack", auth_type: "bearer" });
  const result = await injectClaudeMcpConfig(sandbox as never, {
    userId: "user-1",
    repoId: "repo-1",
    rootDirectory: "app",
    resolveConnections: async (userId, repoId) => {
      assert.equal(userId, "user-1");
      assert.equal(repoId, "repo-1");
      return [conn];
    },
    resolveCredential: async () => "tok-123",
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.mcpConfigPath, ".mogplex/mcp.json");
    assert.equal(result.serverCount, 1);
    assert.deepEqual(result.serverNames, ["slack"]);
  }
  assert.ok(writes.some((w) => w.path === "app/.mogplex/mcp.json"));
  assert.ok(writes.some((w) => w.path === "app/.mogplex/.gitignore"));
});

test("injectClaudeMcpConfig always writes even when no MCP connections are resolved", async () => {
  const { injectClaudeMcpConfig } = await loadMcpConfigModule();
  const { sandbox, writes } = makeSandboxMock();

  const result = await injectClaudeMcpConfig(sandbox as never, {
    userId: "user-1",
    repoId: "repo-1",
    rootDirectory: null,
    resolveConnections: async () => [],
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.serverCount, 0);
    assert.deepEqual(result.serverNames, []);
  }
  // Stale-credential flush: file must still be written, even when empty.
  const mcp = writes.find((w) => w.path === ".mogplex/mcp.json");
  assert.ok(mcp, "expected mcp.json write");
  assert.deepEqual(JSON.parse(mcp.content.toString("utf8")), {
    mcpServers: {},
  });
  assert.ok(writes.some((w) => w.path === ".mogplex/.gitignore"));
});

test("injectClaudeMcpConfig returns ok:false on resolveConnections failure without throwing", async () => {
  const { injectClaudeMcpConfig } = await loadMcpConfigModule();
  const { sandbox } = makeSandboxMock({
    writeFilesOverride: async () => {
      throw new Error("should not be called when resolve fails");
    },
  });

  const result = await injectClaudeMcpConfig(sandbox as never, {
    userId: "user-1",
    repoId: "repo-1",
    rootDirectory: "app",
    resolveConnections: async () => {
      throw new Error("supabase unavailable");
    },
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /supabase unavailable/);
});

test("injectClaudeMcpConfig returns ok:false when writeFiles fails", async () => {
  const { injectClaudeMcpConfig } = await loadMcpConfigModule();
  const { sandbox } = makeSandboxMock({
    writeFilesOverride: async () => {
      throw new Error("sandbox not ready");
    },
  });

  const result = await injectClaudeMcpConfig(sandbox as never, {
    userId: "user-1",
    repoId: "repo-1",
    rootDirectory: "app",
    resolveConnections: async () => [],
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /sandbox not ready/);
});
