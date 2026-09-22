import { createMCPClient } from "@ai-sdk/mcp";
import { buildMcpTransport } from "./mcp-transport";
import { assertSafeOutboundHttpUrlWithDns } from "@/lib/security/outbound-url";
import type { Connection } from "@/lib/types";
import type { Tool } from "ai";

export type McpToolsResult = {
  tools: Record<string, Tool>;
  cleanup: () => Promise<void>;
};

// The existing Control startup budget also bounds saved-server discovery.
export const CONNECTION_TOOL_STARTUP_TIMEOUT_MS = 8000;

export async function getMcpTools(
  conn: Connection,
  credential?: string
): Promise<McpToolsResult> {
  return getRemoteMcpTools(buildMcpTransport(conn, credential));
}

export async function getRemoteMcpTools(
  transport: ReturnType<typeof buildMcpTransport>,
  options: { validateRequests?: boolean; startupSignal?: AbortSignal } = {}
): Promise<McpToolsResult> {
  await assertSafeOutboundHttpUrlWithDns(transport.url, "mcp_url");
  options.startupSignal?.throwIfAborted();
  let starting = true;

  const client = await createMCPClient({
    initializationOptions: { signal: options.startupSignal },
    transport: {
      ...transport,
      // Saved servers use guarded requests. Keep existing Integrations'
      // transport behavior unchanged.
      fetch: options.validateRequests
        ? async (input, init) => {
            const url = input instanceof Request ? input.url : String(input);
            await assertSafeOutboundHttpUrlWithDns(url, "mcp_url");
            const signal =
              starting && options.startupSignal
                ? AbortSignal.any([
                    options.startupSignal,
                    ...(init?.signal ? [init.signal] : []),
                  ])
                : init?.signal;
            signal?.throwIfAborted();
            return fetch(input, { ...init, signal, redirect: "error" });
          }
        : undefined,
    },
  });

  try {
    const tools = await client.tools();
    options.startupSignal?.throwIfAborted();
    let closed = false;
    return {
      tools,
      cleanup: async () => {
        if (closed) return;
        closed = true;
        await client.close();
      },
    };
  } catch (error) {
    await client.close().catch(() => undefined);
    throw error;
  } finally {
    // A startup deadline must never abort a later tool call.
    starting = false;
  }
}

export async function cleanupMcpClients(cleanups: Array<() => Promise<void>>) {
  const results = await Promise.allSettled(
    cleanups.map((cleanup) => cleanup())
  );
  for (const result of results) {
    if (result.status === "rejected") {
      console.warn("[connections] MCP cleanup failed", result.reason);
    }
  }
}
