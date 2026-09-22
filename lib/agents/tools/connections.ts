import type { Tool } from "ai";
import {
  getUserConnections,
  getConnectionCredentials,
} from "@/lib/connections/service";
import { getConnectionApiToolset } from "@/lib/connections/api-toolsets";
import { createRestApiTool } from "@/lib/connections/rest-tool";
import { getMcpTools } from "@/lib/connections/mcp-tools";
import { isStdioConnection } from "@/lib/connections/mcp-transport";
import { isConnectionMisconfigured } from "@/lib/connections/validation";
import { logConnectionEvent } from "@/lib/connections/logging";
import { hasCapability, type Capability } from "@/lib/team-capabilities";
import type { Connection } from "@/lib/types";
import { sanitize } from "./shared";
import { loadSavedMcpServerTools } from "@/lib/mcp-servers/chat";

export const DYNAMIC_CONNECTION_CAPABILITY: Capability = "connections.create";

export { cleanupMcpClients } from "@/lib/connections/mcp-tools";

type LoadedConnectionTools = { connName: string } & (
  | { connType: "rest_api"; tool: Tool }
  | { connType: "api_toolset"; tools: Record<string, Tool> }
  | {
      connType: "mcp_server";
      mcpTools: Awaited<ReturnType<typeof getMcpTools>>;
    }
);

type ConnectionToolDeps = {
  /** Stored credential for a non-OAuth connection. */
  getCredentials: (connectionId: string) => Promise<string>;
};

const DEFAULT_CONNECTION_TOOL_DEPS: ConnectionToolDeps = {
  getCredentials: getConnectionCredentials,
};

/**
 * Resolve one connection's credential and materialize its tools. Throws so the
 * caller's `allSettled` can isolate a single bad connection from the rest.
 */
async function loadConnectionTools(
  conn: Connection,
  ctx: { userId?: string; repoId?: string },
  getValidAccessToken: (conn: Connection) => Promise<string>,
  getCredentials: ConnectionToolDeps["getCredentials"]
): Promise<LoadedConnectionTools | null> {
  try {
    // OAuth gets a fresh access token, others use the stored credential.
    const cred = await (conn.auth_type === "oauth"
      ? getValidAccessToken(conn)
      : getCredentials(conn.id));

    const buildApiToolset = getConnectionApiToolset(conn);
    if (buildApiToolset) {
      if (!cred) throw new Error(`${conn.name} is missing credentials`);
      return {
        connName: conn.name,
        connType: "api_toolset",
        tools: buildApiToolset(cred),
      };
    }

    if (conn.type === "rest_api") {
      return {
        connName: conn.name,
        connType: "rest_api",
        tool: createRestApiTool(conn, cred),
      };
    }

    if (conn.type === "mcp_server") {
      return {
        connName: conn.name,
        connType: "mcp_server",
        mcpTools: await getMcpTools(conn, cred || undefined),
      };
    }

    return null;
  } catch (error) {
    logConnectionEvent("connection_runtime_load_failed", {
      userId: ctx.userId,
      repoId: ctx.repoId,
      connectionId: conn.id,
      presetId: conn.source_preset,
      connectionType: conn.type,
      authType: conn.auth_type,
      reason: error instanceof Error ? error.message : String(error),
      surface: "chat",
    });
    throw error;
  }
}

/**
 * Build the dynamic (REST / MCP) tool map, skipping misconfigured connections.
 *
 * A connection set to `ask` needs the user's approval for every call. Only a
 * surface that can put that question to the user passes `canAskApproval`; any
 * other surface withholds the connection's tools rather than run them unasked.
 */
export async function buildDynamicConnectionTools(
  connections: Connection[],
  ctx: { userId?: string; repoId?: string; canAskApproval?: boolean },
  deps: ConnectionToolDeps = DEFAULT_CONNECTION_TOOL_DEPS
): Promise<{
  dynamicTools: Record<string, Tool>;
  mcpCleanups: Array<() => Promise<void>>;
  mcpToolNames: Set<string>;
  restToolNames: Set<string>;
  /** Tools of `ask` connections; the caller must gate each call on approval. */
  askToolNames: Set<string>;
  /** `ask` connections left out because this surface cannot ask. */
  withheldConnections: Connection[];
}> {
  const { getValidAccessToken } = await import("@/lib/connections/oauth");

  const withheldConnections = ctx.canAskApproval
    ? []
    : connections.filter((conn) => conn.approval_mode === "ask");
  const withheldIds = new Set(withheldConnections.map((conn) => conn.id));

  const runnable = connections.filter((conn) => {
    if (withheldIds.has(conn.id)) return false;
    // Stdio servers need a filesystem to launch in: the sandbox harness and
    // the CLI run them, a server-side turn cannot. One whose preset also has
    // an API toolset still contributes those tools here.
    if (isStdioConnection(conn) && !getConnectionApiToolset(conn)) return false;
    if (!isConnectionMisconfigured(conn)) return true;
    logConnectionEvent("connection_runtime_skipped", {
      userId: ctx.userId,
      repoId: ctx.repoId,
      connectionId: conn.id,
      presetId: conn.source_preset,
      connectionType: conn.type,
      authType: conn.auth_type,
      healthStatus: "misconfigured",
      reason: "misconfigured",
    });
    return false;
  });

  const savedLoading = ctx.userId
    ? loadSavedMcpServerTools(ctx.userId, ctx.canAskApproval)
    : null;
  const results = await Promise.allSettled(
    runnable.map((conn) =>
      loadConnectionTools(conn, ctx, getValidAccessToken, deps.getCredentials)
    )
  );

  const registered = registerLoadedTools(
    results.map((result, index) =>
      result.status === "fulfilled" && result.value
        ? {
            loaded: result.value,
            asks: runnable[index].approval_mode === "ask",
          }
        : null
    )
  );
  if (savedLoading) {
    const saved = await savedLoading;
    registered.mcpCleanups.push(...saved.mcpCleanups);
    for (const [name, tool] of Object.entries(saved.dynamicTools)) {
      // Preserve the permissions and identity of existing integration tools.
      if (name in registered.dynamicTools) continue;
      registered.dynamicTools[name] = tool;
      registered.mcpToolNames.add(name);
      if (saved.askToolNames.has(name)) registered.askToolNames.add(name);
    }
  }
  return { ...registered, withheldConnections };
}

/** Name each loaded tool and sort the names into the sets callers act on. */
function registerLoadedTools(
  entries: Array<{ loaded: LoadedConnectionTools; asks: boolean } | null>
) {
  const dynamicTools: Record<string, Tool> = {};
  const mcpCleanups: Array<() => Promise<void>> = [];
  const mcpToolNames = new Set<string>();
  const restToolNames = new Set<string>();
  const askToolNames = new Set<string>();

  for (const entry of entries) {
    if (!entry) continue;
    const { loaded: val, asks } = entry;

    if (val.connType === "rest_api") {
      const toolName = `api_${sanitize(val.connName)}`;
      dynamicTools[toolName] = val.tool;
      restToolNames.add(toolName);
      if (asks) askToolNames.add(toolName);
      continue;
    }

    // An API toolset is named and idempotency-protected like MCP tools:
    // several per connection, and some of them write.
    const namespaced =
      val.connType === "api_toolset" ? val.tools : val.mcpTools.tools;
    if (val.connType === "mcp_server") mcpCleanups.push(val.mcpTools.cleanup);
    for (const [name, t] of Object.entries(namespaced)) {
      const toolName = `${sanitize(val.connName)}_${name}`;
      dynamicTools[toolName] = t;
      mcpToolNames.add(toolName);
      if (asks) askToolNames.add(toolName);
    }
  }

  return {
    dynamicTools,
    mcpCleanups,
    mcpToolNames,
    restToolNames,
    askToolNames,
  };
}

/**
 * Connection (REST / MCP) tools share `connections.create` in v1. If the role
 * lacks it, the caller skips the connection lookups entirely — no value in
 * resolving credentials we won't expose. Records the denial as a side effect so
 * the audit trail matches what the caller actually withheld.
 */
export function canUseConnectionTools(
  capabilities: ReadonlySet<Capability>,
  teamId: string | null | undefined,
  deniedTools: Array<{
    toolName: string;
    requiredCapability: Capability | null;
  }>
): boolean {
  if (hasCapability(capabilities, DYNAMIC_CONNECTION_CAPABILITY)) return true;
  if (teamId) {
    deniedTools.push({
      toolName: "connections",
      requiredCapability: DYNAMIC_CONNECTION_CAPABILITY,
    });
  }
  return false;
}

/** Connections visible to this scope; a repoId narrows them to that repo. */
export async function loadScopedConnections(
  userId: string,
  repoId: string | undefined
): Promise<Connection[]> {
  const { getResolvedConnections } = await import("@/lib/connections/service");
  const load = repoId
    ? getResolvedConnections(userId, repoId)
    : getUserConnections(userId);
  return await load.catch(() => [] as Connection[]);
}
