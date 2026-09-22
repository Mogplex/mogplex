import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getScopeContext } from "@/lib/scope-context";
import { getLegacySettingsDestination } from "@/lib/settings-redirect";

export const metadata: Metadata = {
  title: "MCP Servers | Mogplex",
  description: "Manage synced MCP server definitions for Mogplex CLI access.",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function McpServersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const scope = await getScopeContext();
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (Array.isArray(value)) value.forEach((item) => params.append(key, item));
    else if (value !== undefined) params.set(key, value);
  }
  params.set("tab", "mcp");
  redirect(getLegacySettingsDestination(scope, params.toString()));
}
