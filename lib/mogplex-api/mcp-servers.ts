import { listConnectionsForCli } from "@/lib/connections/cli";
import {
  listUserMcpServersForCli,
  type McpServerCliRecord,
} from "@/lib/mcp-servers";

export type MogplexApiMcpServer = McpServerCliRecord;

/**
 * v1 MCP server listing — returns the same merged shape the CLI consumes
 * from `/api/mcp-servers?format=cli`, but behind a PAT-only route.
 *
 * Custom `user_mcp_servers` rows take precedence over `connections` rows on
 * name collision; this matches the legacy endpoint exactly so the migration
 * is a pure transport swap.
 */
export async function listMogplexApiMcpServers(
  userId: string
): Promise<MogplexApiMcpServer[]> {
  const [custom, connections] = await Promise.all([
    listUserMcpServersForCli(userId),
    listConnectionsForCli(userId),
  ]);
  const customNames = new Set(custom.map((s) => s.name));
  return [...custom, ...connections.filter((c) => !customNames.has(c.name))];
}
