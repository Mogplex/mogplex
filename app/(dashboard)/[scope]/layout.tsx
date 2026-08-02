import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { ActiveScopeProvider } from "@/components/active-scope-provider";
import {
  isImageAssetScopeSegment,
  parseScopeContextHeaders,
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
  const scope = parseScopeContextHeaders(scopeHeaders);

  if (!scope) {
    // Missing image files bypass proxy.ts and can fall through to /[scope].
    // Keep real scoped-route header failures loud so matcher regressions page us.
    if (isImageAssetScopeSegment(scopeSegment)) notFound();
    throw new Error(
      "ScopeLayout: x-mogplex-scope-* headers missing for scoped route"
    );
  }

  return (
    <ActiveScopeProvider teamId={scope.kind === "team" ? scope.teamId : null}>
      {children}
    </ActiveScopeProvider>
  );
}
