/**
 * MCP (Model Context Protocol) tools for the orchestrator.
 */
import { z } from "zod";
import type { OrchestratorToolDef } from "../types";

// --- Tool definitions ---

export const MCP_TOOLS: OrchestratorToolDef[] = [
  {
    name: "mcp_list_servers",
    category: "mcp",
    description: "List available MCP servers for this workspace",
    access: "read",
    implemented: false,
  },
  {
    name: "mcp_discover_tools",
    category: "mcp",
    description: "Discover tools exposed by an MCP server",
    access: "read",
    implemented: false,
  },
  {
    name: "mcp_call",
    category: "mcp",
    description: "Call a tool on an MCP server",
    access: "mutation",
    implemented: false,
  },
  {
    name: "mcp_health_check",
    category: "mcp",
    description: "Check the health status of an MCP server",
    access: "read",
    implemented: false,
  },
  {
    name: "mcp_grant",
    category: "mcp",
    description: "Grant an agent access to an MCP server (requires approval)",
    access: "approval",
    implemented: false,
  },
  {
    name: "mcp_revoke",
    category: "mcp",
    description:
      "Revoke an agent's access to an MCP server (requires approval)",
    access: "approval",
    implemented: false,
  },
];

// --- Schemas ---

export const mcpListServersSchema = z.object({});

export const mcpDiscoverToolsSchema = z.object({
  serverId: z.string().describe("MCP server ID"),
});

export const mcpCallSchema = z.object({
  serverId: z.string().describe("MCP server ID"),
  toolName: z.string().describe("Tool name"),
  args: z.record(z.string(), z.unknown()).describe("Tool arguments"),
});

export const mcpHealthCheckSchema = z.object({
  serverId: z.string().describe("MCP server ID"),
});

export const mcpGrantSchema = z.object({
  agentId: z.string().describe("Agent to grant access"),
  serverId: z.string().describe("MCP server ID"),
});

export const mcpRevokeSchema = z.object({
  agentId: z.string().describe("Agent to revoke access"),
  serverId: z.string().describe("MCP server ID"),
});

// --- Schema map for stub tools ---

export const MCP_SCHEMAS: Record<string, z.ZodType> = {
  mcp_list_servers: mcpListServersSchema,
  mcp_discover_tools: mcpDiscoverToolsSchema,
  mcp_call: mcpCallSchema,
  mcp_health_check: mcpHealthCheckSchema,
  mcp_grant: mcpGrantSchema,
  mcp_revoke: mcpRevokeSchema,
};
