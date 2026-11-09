import type { Connection } from "@/lib/types/connection";
import { type ConnectionPreset, getConnectionPreset } from "./presets";

export type OAuthProfile = NonNullable<ConnectionPreset["oauth_config"]>;

/**
 * A custom MCP server signs in the way the MCP authorization spec describes:
 * the server's protected-resource metadata names its authorization server,
 * Mogplex registers itself as a public client, and every request uses PKCE
 * and names the MCP server as the token's resource.
 */
export const CUSTOM_MCP_OAUTH_PROFILE: OAuthProfile = {
  discovery: "rfc9728",
  registration: "dynamic",
  use_pkce: true,
  use_resource_indicator: true,
  token_endpoint_auth_method: "none",
};

/** How a connection signs in through the browser, or null when it does not. */
export function getOAuthProfile(
  connection: Pick<Connection, "source_preset" | "type" | "auth_type">
): OAuthProfile | null {
  const preset = getConnectionPreset(connection.source_preset);
  if (preset) return preset.oauth_config ?? null;
  return connection.type === "mcp_server" && connection.auth_type === "oauth"
    ? CUSTOM_MCP_OAUTH_PROFILE
    : null;
}
