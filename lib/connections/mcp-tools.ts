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
  return getRemoteMcpTools(buildMcpTransport(conn, credential));
}

export async function getRemoteMcpTools(
  transport: ReturnType<typeof buildMcpTransport>
): Promise<McpToolsResult> {
  await assertSafeOutboundHttpUrlWithDns(transport.url, "mcp_url");

  const client = await createMCPClient({
    transport: {
      ...transport,
      // Validate every outbound request, including a legacy SSE message URL.
      // Do not let redirects forward stored headers to an unchecked target.
      fetch: async (input, init) => {
        const url = input instanceof Request ? input.url : String(input);
        await assertSafeOutboundHttpUrlWithDns(url, "mcp_url");
        return fetch(input, { ...init, redirect: "error" });
      },
    },
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
