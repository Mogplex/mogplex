import type { Metadata } from "next";
import { headers } from "next/headers";
import { ActiveScopeProvider } from "@/components/active-scope-provider";
import { DashboardShell } from "@/components/dashboard-shell";
import { SelfHostedProvider } from "@/components/self-hosted-provider";
import { TerminalHost } from "@/components/terminal-host";
import { parseScopeContextForLayout } from "@/lib/scope-context";
import { PRIVATE_NO_INDEX_ROBOTS } from "@/lib/seo";
import { isSelfHostedMode } from "@/lib/self-hosted";

export const metadata: Metadata = {
  robots: PRIVATE_NO_INDEX_ROBOTS,
};

export default async function ScopeLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ scope: string }>;
}) {
  const [scopeHeaders, { scope: scopeSegment }] = await Promise.all([
    headers(),
    params,
  ]);

  const scope = parseScopeContextForLayout(scopeSegment, scopeHeaders);

  return (
    <ActiveScopeProvider teamId={scope.kind === "team" ? scope.teamId : null}>
      <SelfHostedProvider selfHosted={isSelfHostedMode()}>
        <TerminalHost />
        <DashboardShell>{children}</DashboardShell>
      </SelfHostedProvider>
    </ActiveScopeProvider>
  );
}
