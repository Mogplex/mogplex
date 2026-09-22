"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getLegacySettingsDestination } from "@/lib/settings-redirect";
import type { ScopeContext } from "@/lib/scope-context";

export function SettingsPageClient({ scope }: { scope: ScopeContext }) {
  const router = useRouter();
  const query = useSearchParams().toString();
  useEffect(() => {
    // Keep the root redirect client-side: legacy hash links are not sent to the server.
    router.replace(getLegacySettingsDestination(scope, query, window.location.hash), { scroll: false });
  }, [scope, query, router]);
  return <p className="p-6 text-sm text-muted-foreground" role="status">Opening Settings…</p>;
}
