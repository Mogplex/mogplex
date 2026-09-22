import { createHash } from "node:crypto";
import type { Tool } from "ai";
import { readToolPolicy, toolApproval } from "./policy";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  getRemoteMcpTools,
  CONNECTION_TOOL_STARTUP_TIMEOUT_MS,
} from "@/lib/connections/mcp-tools";
import { assertSafeOutboundHttpUrlWithDns } from "@/lib/security/outbound-url";
import { sanitize } from "@/lib/agents/tools/shared";
import { normalizeStringRecord } from "./validation";
import { resolveVaultSecrets } from "./secrets";
import type { McpServerRow } from "./types";

export type ChatServerRow = Pick<
  McpServerRow,
  "id" | "name" | "url" | "header_refs" | "header_plain" | "extra"
>;

export async function listSavedHttpMcpServers(
  userId: string,
  db = supabaseAdmin
) {
  const { data, error } = await db
    .from("user_mcp_servers")
    .select("id, name, url, header_refs, header_plain, extra")
    .eq("user_id", userId)
    .eq("enabled", true)
    .eq("transport", "http")
    .order("created_at");
  if (error) throw error;
  return (data ?? []) as ChatServerRow[];
}

export function duringStartup<T>(
  work: Promise<T>,
  signal: AbortSignal
): Promise<T> {
  let onAbort: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason);
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
  return Promise.race([work, aborted]).finally(() => {
    signal.removeEventListener("abort", onAbort);
  });
}

export class MissingMcpSecretError extends Error {}

// Return partial results before Control's outer deadline.
export const SAVED_MCP_STARTUP_TIMEOUT_MS =
  CONNECTION_TOOL_STARTUP_TIMEOUT_MS - 2000;

export async function loadSavedServer(
  server: ChatServerRow,
  signal: AbortSignal,
  cleanupSignal?: () => AbortSignal
) {
  const policy = readToolPolicy(server.extra);
  if (!server.url) throw new Error("Missing MCP URL");
  // Local HTTP servers still sync to the CLI. The hosted runtime must not
  // read their secrets or dial private addresses.
  await assertSafeOutboundHttpUrlWithDns(server.url, "mcp_url");
  signal.throwIfAborted();
  const refs = normalizeStringRecord(server.header_refs, "header_refs");
  const headers = normalizeStringRecord(server.header_plain, "header_plain");
  const secrets = await resolveVaultSecrets(Object.values(refs));
  signal.throwIfAborted();
  for (const [name, id] of Object.entries(refs)) {
    const value = secrets.get(id);
    if (value === undefined)
      throw new MissingMcpSecretError("Missing MCP secret");
    headers[name] = value;
  }
  // Detach a healthy session from the shared deadline: its startup requests
  // can include streams that stay open for the lifetime of the client.
  const startup = new AbortController();
  const abort = () => startup.abort(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  try {
    return {
      server,
      policy,
      loaded: await getRemoteMcpTools(
        { type: "http", url: server.url, headers },
        { validateRequests: true, startupSignal: startup.signal, cleanupSignal }
      ),
    };
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

/** The catalog is personal. Filter before reading any Vault-backed headers. */
export async function loadSavedMcpServerTools(
  userId: string,
  canAskApproval = false
) {
  const dynamicTools: Record<string, Tool> = {};
  const mcpCleanups: Array<() => Promise<void>> = [];
  const askToolNames = new Set<string>();
  const startup = new AbortController();
  const timer = setTimeout(
    () => startup.abort(new Error("MCP startup timed out")),
    // Leave time to return healthy results before Control's outer deadline.
    SAVED_MCP_STARTUP_TIMEOUT_MS
  );
  try {
    const servers = await duringStartup(
      listSavedHttpMcpServers(userId),
      startup.signal
    );
    const results = await Promise.allSettled(
      servers.map((server) =>
        duringStartup(loadSavedServer(server, startup.signal), startup.signal)
      )
    );
    for (const [index, result] of results.entries()) {
      if (result.status === "rejected") {
        // Upstream errors may include secret-bearing URLs or header values.
        console.warn(
          "[mcp-servers] A saved HTTP server could not load for chat",
          {
            userId,
            serverId: servers[index].id,
            timedOut:
              startup.signal.aborted && result.reason === startup.signal.reason,
          }
        );
        continue;
      }
      const { server, loaded, policy } = result.value;
      mcpCleanups.push(loaded.cleanup);
      for (const [name, tool] of Object.entries(loaded.tools)) {
        const approval = toolApproval(policy, name);
        if (approval === "deny" || (approval === "prompt" && !canAskApproval))
          continue;
        const hash = createHash("sha256")
          .update(`${server.id}:${name}`)
          .digest("hex")
          .slice(0, 12);
        const toolName = `saved_${sanitize(server.name).slice(0, 18)}_${sanitize(name).slice(0, 24)}_${hash}`;
        dynamicTools[toolName] = {
          ...tool,
          description: `${server.name}: ${tool.description ?? name}`,
        } as Tool;
        if (approval === "prompt") askToolNames.add(toolName);
      }
    }
  } catch {
    console.warn("[mcp-servers] Saved HTTP servers could not load for chat", {
      userId,
      timedOut: startup.signal.aborted,
    });
  } finally {
    clearTimeout(timer);
  }
  return { dynamicTools, mcpCleanups, askToolNames };
}
