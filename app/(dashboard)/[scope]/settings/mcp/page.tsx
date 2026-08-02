import type { Metadata } from "next";
import { McpServersPageClient } from "@/components/settings/mcp-servers-page-client";

export const metadata: Metadata = {
  title: "MCP Servers | Mogplex",
  description: "Manage synced MCP server definitions for Mogplex CLI access.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function McpServersPage() {
  return <McpServersPageClient />;
}
