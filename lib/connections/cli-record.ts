import {
  buildMcpStdioLaunch,
  buildMcpTransport,
  isStdioConnection,
} from "./mcp-transport";
import type { Connection } from "@/lib/types";

export type CliMcpRecord = {
  name: string;
  enabled: boolean;
  config: Record<string, unknown>;
};

/**
 * CLI-ready config for one runnable connection: `command/args/env` for a
 * stdio preset, `url/http_headers` otherwise. Null when a stdio row has no
 * launch spec behind it.
 */
export function buildCliMcpRecord(
  conn: Connection,
  credential: string
): CliMcpRecord | null {
  if (isStdioConnection(conn)) {
    const launch = buildMcpStdioLaunch(conn, credential);
    if (!launch) return null;
    return {
      name: conn.name,
      enabled: true,
      config: {
        command: launch.command,
        args: launch.args,
        env: launch.env,
      },
    };
  }

  const transport = buildMcpTransport(conn, credential);
  return {
    name: conn.name,
    enabled: true,
    config: {
      url: transport.url,
      http_headers: transport.headers,
    },
  };
}
