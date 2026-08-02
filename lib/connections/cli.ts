import { supabaseAdmin } from "@/lib/supabase/admin";
import { decrypt } from "./encryption";
import { buildMcpTransport } from "./mcp-transport";
import { isConnectionMisconfigured } from "./validation";
import { getValidAccessToken } from "./oauth";
import type { Connection } from "@/lib/types";

const CONNECTION_COLUMNS =
  "id, user_id, name, type, base_url, auth_type, auth_header, mcp_transport, mcp_url, description, is_enabled, health_status, scope, repo_id, oauth_client_id, oauth_authorize_url, oauth_token_url, oauth_scopes, oauth_authorized_at, oauth_token_expires_at, source_preset, last_tested_at, last_test_error, last_test_http_status, last_test_tool_count, created_at, updated_at";

type CliMcpRecord = {
  name: string;
  enabled: boolean;
  config: Record<string, unknown>;
};

/** Return all enabled mcp_server connections as CLI-ready config records. */
export async function listConnectionsForCli(
  userId: string
): Promise<CliMcpRecord[]> {
  const { data, error } = await supabaseAdmin
    .from("connections")
    .select(`${CONNECTION_COLUMNS}, encrypted_credentials`)
    .eq("user_id", userId)
    .eq("type", "mcp_server")
    .eq("is_enabled", true)
    .order("created_at");

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Array<
    Connection & { encrypted_credentials: string | null }
  >;
  const results: CliMcpRecord[] = [];

  for (const conn of rows) {
    if (isConnectionMisconfigured(conn)) continue;

    let credential = conn.encrypted_credentials
      ? decrypt(conn.encrypted_credentials)
      : "";

    if (conn.auth_type === "oauth") {
      if (!conn.oauth_authorized_at) continue;
      try {
        credential = await getValidAccessToken(conn);
      } catch {
        continue;
      }
    }

    const transport = buildMcpTransport(conn, credential);
    results.push({
      name: conn.name,
      enabled: true,
      config: {
        url: transport.url,
        http_headers: transport.headers,
      },
    });
  }

  return results;
}
