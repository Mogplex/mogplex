import { tool } from "ai";
import { z } from "zod";
import { buildConnectionAuthHeaders } from "./mcp-transport";
import { assertSafeOutboundHttpUrlWithDns } from "@/lib/security/outbound-url";
import type { Tool } from "ai";
import type { Connection } from "@/lib/types";

const defineTool = (def: Record<string, unknown>): Tool =>
  tool(def as unknown as Tool);

export function createRestApiTool(conn: Connection, credential: string) {
  return defineTool({
    description: `Call ${conn.name} API${conn.description ? `: ${conn.description}` : ` (${conn.base_url})`}`,
    inputSchema: z.object({
      method: z
        .enum(["GET", "POST", "PUT", "PATCH", "DELETE"])
        .default("GET")
        .describe("HTTP method"),
      path: z.string().describe("Path appended to the base URL"),
      body: z.string().optional().describe("JSON request body"),
      query: z.string().optional().describe("Query string (without leading ?)"),
    }),
    execute: async ({
      method,
      path,
      body,
      query,
    }: {
      method: string;
      path: string;
      body?: string;
      query?: string;
    }) => {
      const url = await assertSafeOutboundHttpUrlWithDns(
        `${conn.base_url}${path}${query ? `?${query}` : ""}`,
        "base_url"
      );
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...buildConnectionAuthHeaders(conn, credential),
      };

      const res = await fetch(url, {
        method,
        headers,
        body: body || undefined,
      });

      const text = await res.text();
      return { status: res.status, body: text.slice(0, 8000) };
    },
  });
}
