import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { ActiveScopeProvider } from "@/components/active-scope-provider";
import { TerminalHost } from "@/components/terminal-host";
import {
  isImageAssetScopeSegment,
  parseScopeContextHeaders,
  SCOPE_LAYOUT_MISSING_HEADERS_ERROR,
} from "@/lib/scope-context";
import { PRIVATE_NO_INDEX_ROBOTS } from "@/lib/seo";

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

  // Missing image files bypass proxy.ts (the matcher excludes image
  // extensions), so the proxy never injects scope headers for them — any
  // x-mogplex-scope-* values on such a request are client-supplied. 404
  // before parsing headers so forged values are never trusted. Real slugs
  // never end in an image extension.
  if (isImageAssetScopeSegment(scopeSegment)) notFound();

  const scope = parseScopeContextHeaders(scopeHeaders);

  if (!scope) {
    // Keep real scoped-route header failures loud so matcher regressions page us.
    throw new Error(SCOPE_LAYOUT_MISSING_HEADERS_ERROR);
  }

  return (
    <ActiveScopeProvider teamId={scope.kind === "team" ? scope.teamId : null}>
      <TerminalHost />
      {children}
    </ActiveScopeProvider>
  );
}
