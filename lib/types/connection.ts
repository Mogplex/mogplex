/**
 * Connection-related types for REST APIs and MCP servers.
 */

import type { ConnectionHealthStatus } from "@/lib/connections/health-status";

export type Connection = {
  id: string;
  user_id: string;
  name: string;
  type: "rest_api" | "mcp_server";
  base_url: string | null;
  auth_type: "none" | "api_key" | "bearer" | "basic" | "oauth" | null;
  auth_header: string | null;
  mcp_transport: "sse" | "http" | null;
  mcp_url: string | null;
  description: string | null;
  is_enabled: boolean;
  health_status: ConnectionHealthStatus;
  scope: "global" | "project";
  repo_id: string | null;
  oauth_client_id: string | null;
  oauth_authorize_url: string | null;
  oauth_token_url: string | null;
  oauth_scopes: string | null;
  oauth_authorized_at: string | null;
  oauth_token_expires_at: string | null;
  source_preset: string | null;
  last_tested_at: string | null;
  last_test_error: string | null;
  last_test_http_status: number | null;
  last_test_tool_count: number | null;
  created_at: string;
  updated_at: string;
};

export type ConnectionOverride = {
  id: string;
  repo_id: string;
  connection_id: string | null;
  excluded: boolean;
  created_at: string;
};
