import { buildMcpTransport } from "@/lib/connections/mcp-transport";
import { getConnectionCredentials } from "@/lib/connections/service";
import { logConnectionEvent } from "@/lib/connections/logging";
import { getValidAccessToken } from "@/lib/connections/oauth";
import { isConnectionMisconfigured } from "@/lib/connections/validation";
import { resolveSandboxPath } from "@/lib/repo-settings";
import type { Connection } from "@/lib/types";
import type { Sandbox } from "@vercel/sandbox";

export type ClaudeMcpServerEntry = {
  type: "http" | "sse";
  url: string;
  headers: Record<string, string>;
};

export type ClaudeMcpConfig = {
  mcpServers: Record<string, ClaudeMcpServerEntry>;
};

function sanitizeServerName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^\da-z]+/g, "_")
      .replace(/^_|_$/g, "") || "mcp"
  );
}

function uniqueKey(
  base: string,
  used: Set<string>,
  fallbackId: string
): string {
  if (!used.has(base)) return base;
  const withId = `${base}_${fallbackId.slice(0, 8)}`;
  if (!used.has(withId)) return withId;
  let n = 2;
  while (used.has(`${withId}_${n}`)) n += 1;
  return `${withId}_${n}`;
}

async function resolveConnectionCredential(
  conn: Connection
): Promise<string | undefined> {
  // Mirrors lib/agents/tools.ts:948 exactly: OAuth gets a fresh access token,
  // everything else uses the stored credential. Any falsy result (null, "",
  // undefined) is coerced to undefined so buildMcpTransport's `if (credential)`
  // branch is hit consistently with the Vercel AI SDK path.
  const cred =
    conn.auth_type === "oauth"
      ? await getValidAccessToken(conn)
      : await getConnectionCredentials(conn.id);
  return cred || undefined;
}

export type CredentialResolver = (
  conn: Connection
) => Promise<string | undefined>;

/**
 * Build the Claude Code `--mcp-config` payload from a user's
 * runnable mcp_server connections.
 *
 * `options.userId` is required (non-optional) when `options` is
 * provided so a per-connection credential failure can persist a
 * `connection_runtime_load_failed` event with `surface='harness'`
 * to the connection_events table. If the entire `options` object
 * is omitted, the failure path silently degrades to console-only
 * logging (the logger's persistable-event guard emits a warn at
 * runtime; see lib/connections/logging.ts:buildConnectionEventInsert).
 *
 * The single production caller (`injectClaudeMcpConfig`) always
 * threads `opts.userId` through, so this only matters for tests
 * and any future caller — the type-level requirement on the inner
 * field stops a partial `{}` from compiling and keeps the
 * observability gap from accumulating silently.
 */
export async function buildClaudeMcpConfig(
  connections: Connection[],
  resolveCredential: CredentialResolver = resolveConnectionCredential,
  options?: { userId: string }
): Promise<ClaudeMcpConfig> {
  const mcpServers: Record<string, ClaudeMcpServerEntry> = {};
  const used = new Set<string>();

  const runnable = connections.filter(
    (conn) => conn.type === "mcp_server" && !isConnectionMisconfigured(conn)
  );

  // Wrap each per-connection resolution so a rejection still carries
  // the conn reference. With a bare `Promise.allSettled(map(async fn))`
  // the rejected case loses the input — and the original code's
  // `if (result.status !== "fulfilled") continue` silently dropped any
  // MCP whose credential resolution failed (expired refresh token,
  // OAuth provider outage, etc.). Now each rejection flows through
  // the connection_runtime_load_failed emit on the harness surface.
  type ResolveOutcome =
    | {
        ok: true;
        conn: Connection;
        transport: ReturnType<typeof buildMcpTransport>;
      }
    | { ok: false; conn: Connection; error: unknown };

  const entries = await Promise.all(
    runnable.map(async (conn): Promise<ResolveOutcome> => {
      try {
        const cred = await resolveCredential(conn);
        return { ok: true, conn, transport: buildMcpTransport(conn, cred) };
      } catch (error) {
        return { ok: false, conn, error };
      }
    })
  );

  for (const result of entries) {
    if (!result.ok) {
      logConnectionEvent("connection_runtime_load_failed", {
        userId: options?.userId,
        repoId: result.conn.repo_id,
        connectionId: result.conn.id,
        presetId: result.conn.source_preset,
        connectionType: result.conn.type,
        authType: result.conn.auth_type,
        reason:
          result.error instanceof Error
            ? result.error.message
            : String(result.error),
        surface: "harness",
      });
      continue;
    }

    const { conn, transport } = result;
    if (!transport.url) continue;

    const key = uniqueKey(sanitizeServerName(conn.name), used, conn.id);
    used.add(key);
    mcpServers[key] = {
      type: transport.type,
      url: transport.url,
      headers: transport.headers,
    };
  }

  return { mcpServers };
}

type McpConfigWritableSandbox = Pick<Sandbox, "writeFiles" | "readFile">;

/**
 * Path (CWD-relative) of the MCP config the Claude Code harness reads via
 * `--mcp-config`. Written under `.mogplex/` alongside other harness-owned
 * sandbox files (see `lib/harness/install.ts`), which keeps secrets out of
 * the user's visible working tree and avoids collisions with any user-owned
 * `.mcp.json` the repo may ship.
 */
export const CLAUDE_MCP_CONFIG_FILENAME = ".mogplex/mcp.json";

// Self-ignoring .gitignore pinned inside .mogplex/. The `*` pattern ignores
// every sibling (including this file itself), so broad git staging in the
// sandbox checkout can never include mcp.json bearer tokens — regardless of
// whether the user's repo root has a .mogplex ignore rule.
const MOGPLEX_GITIGNORE_FILENAME = ".mogplex/.gitignore";
const MOGPLEX_GITIGNORE_CONTENT = "*\n";

/**
 * Seed `.mogplex/.gitignore` with `*` only when the repo doesn't already own
 * one. If the user tracks their own `.mogplex/.gitignore`, overwriting it
 * would dirty the working tree and — because tracked files override ignore
 * rules — could leak the change into a broad agent commit. On a read error
 * (file missing in the sandbox VFS, permission, etc.) we assume absent and
 * seed it: the whole point is defense-in-depth, so failing-open here would
 * defeat the guard.
 */
async function ensureMogplexGitignore(
  sandbox: McpConfigWritableSandbox,
  rootDirectory: string | null | undefined
): Promise<void> {
  const path = resolveSandboxPath(rootDirectory, MOGPLEX_GITIGNORE_FILENAME);
  try {
    const existing = await sandbox.readFile({ path });
    if (existing) return;
  } catch {
    // fall through to write — treat unreadable as absent
  }
  await sandbox.writeFiles([
    { path, content: Buffer.from(MOGPLEX_GITIGNORE_CONTENT) },
  ]);
}

/**
 * Write the MCP config into the sandbox harness CWD. Always called before
 * invoking `claude-code` so stale bearer tokens from prior runs get
 * overwritten even when the user has removed every MCP. Seeds a
 * self-ignoring `.mogplex/.gitignore` the first time (never overwrites a
 * repo-owned one) so the config cannot be accidentally committed by a
 * harness commit.
 */
export async function writeClaudeMcpConfig(
  sandbox: McpConfigWritableSandbox,
  rootDirectory: string | null | undefined,
  config: ClaudeMcpConfig
): Promise<string> {
  await ensureMogplexGitignore(sandbox, rootDirectory);
  await sandbox.writeFiles([
    {
      path: resolveSandboxPath(rootDirectory, CLAUDE_MCP_CONFIG_FILENAME),
      content: Buffer.from(JSON.stringify(config, null, 2)),
    },
  ]);
  return CLAUDE_MCP_CONFIG_FILENAME;
}

export type InjectClaudeMcpConfigResult =
  | {
      ok: true;
      mcpConfigPath: string;
      serverCount: number;
      serverNames: string[];
    }
  | { ok: false; error: string };

/**
 * Resolve user-connected MCPs and write `.mogplex/mcp.json` to the sandbox
 * harness CWD. Always overwrites (even with `mcpServers: {}`) so removed
 * MCPs do not leave stale bearer tokens behind. Returns a structured
 * result instead of throwing so the caller can log without interrupting
 * the harness run.
 */
export async function injectClaudeMcpConfig(
  sandbox: McpConfigWritableSandbox,
  opts: {
    userId: string;
    repoId: string;
    rootDirectory: string | null | undefined;
    resolveConnections: (
      userId: string,
      repoId: string
    ) => Promise<Connection[]>;
    resolveCredential?: CredentialResolver;
  }
): Promise<InjectClaudeMcpConfigResult> {
  try {
    const connections = await opts.resolveConnections(opts.userId, opts.repoId);
    const mcpConfig = await buildClaudeMcpConfig(
      connections,
      opts.resolveCredential,
      { userId: opts.userId }
    );
    const mcpConfigPath = await writeClaudeMcpConfig(
      sandbox,
      opts.rootDirectory,
      mcpConfig
    );
    const serverNames = Object.keys(mcpConfig.mcpServers);
    return {
      ok: true,
      mcpConfigPath,
      serverCount: serverNames.length,
      serverNames,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
