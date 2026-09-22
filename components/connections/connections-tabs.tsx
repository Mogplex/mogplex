"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { McpServersPageClient } from "@/components/settings/mcp-servers-page-client";
import { ConnectionsSection } from "./connections-section";
import { SlackInstallToast } from "./slack-install-toast";

export function ConnectionsTabs() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab") === "mcp" ? "mcp" : "integrations";

  const changeTab = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "mcp") params.set("tab", "mcp");
    else params.delete("tab");
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  return (
    <Tabs value={tab} onValueChange={changeTab}>
      <TabsList aria-label="Connections sections">
        <TabsTrigger value="integrations">Integrations</TabsTrigger>
        <TabsTrigger value="mcp">MCP Servers</TabsTrigger>
      </TabsList>
      <TabsContent value="integrations">
        <SlackInstallToast />
        <ConnectionsSection />
      </TabsContent>
      <TabsContent value="mcp">
        <McpServersPageClient />
      </TabsContent>
    </Tabs>
  );
}
