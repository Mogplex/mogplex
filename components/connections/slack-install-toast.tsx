"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useSWRConfig } from "swr";
import { toast } from "@/hooks/use-toast";

const MESSAGES: Record<
  string,
  { title: string; description?: string; variant?: "destructive" }
> = {
  connected: {
    title: "Slack workspace connected",
    description: "The Mogplex bot can now reply in DMs and linked channels.",
  },
  linked: {
    title: "Slack account linked",
    description: "Mogplex can now act on Slack requests from your account.",
  },
  denied: {
    title: "Slack install cancelled",
    description: "No workspace was connected.",
  },
  invalid_state: {
    title: "Slack install failed",
    description: "Security check didn't match — try installing again.",
    variant: "destructive",
  },
  error: {
    title: "Slack install failed",
    description: "Something went wrong. Try again or check the server logs.",
    variant: "destructive",
  },
  not_configured: {
    title: "Slack not configured",
    description: "Set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET in your env.",
    variant: "destructive",
  },
};

/**
 * Surfaces the OAuth callback redirect (`?slack=connected`, `?slack=error`,
 * …) as a toast, then strips the query so a refresh doesn't re-fire it.
 */
export function SlackInstallToast() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { mutate } = useSWRConfig();
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    const status = params.get("slack");
    if (!status) return;
    fired.current = true;

    const msg = MESSAGES[status];
    if (msg) toast(msg);

    if (status === "connected" || status === "linked") {
      mutate("/api/integrations/slack/installations").catch((err) => {
        console.error(
          "[SlackInstallToast] failed to revalidate installations:",
          err,
        );
      });
    }

    const next = new URLSearchParams(params);
    next.delete("slack");
    next.delete("team");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }, [params, pathname, router, mutate]);

  return null;
}
