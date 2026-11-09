"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useSWRConfig } from "swr";
import { toast } from "@/hooks/use-toast";
import { getGithubInstallToast } from "@/lib/github-install-outcome";

const GITHUB_OUTCOME_PARAMS = ["github", "reason", "repo_sync"];

function isGithubStateKey(key: unknown) {
  const path = Array.isArray(key) ? key[0] : key;
  return (
    typeof path === "string" &&
    (path.startsWith("/api/github") ||
      path.startsWith("/api/repos") ||
      path === "/api/auth/user")
  );
}

/**
 * Surfaces the GitHub connect callback (`?github=connected`,
 * `?github=error&reason=…`) as a toast, refreshes GitHub-backed data, then
 * strips the query so a refresh doesn't re-fire it.
 */
export function GithubInstallToast() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { mutate } = useSWRConfig();
  const fired = useRef(false);

  useEffect(() => {
    const message = getGithubInstallToast(params);
    if (!message) return;
    // A page redirect (e.g. /settings → /settings/account) can carry the
    // query forward after we strip it, so strip again but toast only once.
    if (!fired.current) {
      fired.current = true;
      toast(message);
      if (params.get("github") === "connected") {
        mutate(isGithubStateKey).catch((err) => {
          console.error("[GithubInstallToast] failed to revalidate:", err);
        });
      }
    }

    const next = new URLSearchParams(params);
    for (const key of GITHUB_OUTCOME_PARAMS) next.delete(key);
    const qs = next.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}${window.location.hash}`, {
      scroll: false,
    });
  }, [params, pathname, router, mutate]);

  return null;
}
