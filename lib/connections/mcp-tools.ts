import { createMCPClient } from "@ai-sdk/mcp";
import { buildMcpTransport } from "./mcp-transport";
import { assertSafeOutboundHttpUrlWithDns } from "@/lib/security/outbound-url";
import type { Connection } from "@/lib/types";
import type { Tool } from "ai";

export type McpToolsResult = {
  tools: Record<string, Tool>;
  cleanup: () => Promise<void>;
};

export async function getMcpTools(
  conn: Connection,
  credential?: string
): Promise<McpToolsResult> {
  if (conn.mcp_url) {
    await assertSafeOutboundHttpUrlWithDns(conn.mcp_url, "mcp_url");
  }

  const client = await createMCPClient({
    transport: buildMcpTransport(conn, credential),
  });

  try {
    const tools = await client.tools();
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
