"use client";

import { useEffect, useMemo, useState } from "react";
import type { UIMessage } from "ai";
import {
  EMPTY_SESSION_USAGE,
  extractAiCallIds,
  type SessionUsage,
} from "@/lib/control/session-usage";

/**
 * Fetch summed token/cost usage for the ai_calls behind the current chat.
 * Event-driven: refetches when the run finishes (chatPending flips false)
 * or the set of streamed ai_call ids changes — never polls, since
 * ai_calls.cost_usd is written by the compute trigger at run finish.
 */
export function useSessionUsage(
  messages: UIMessage[],
  chatPending: boolean
): SessionUsage {
  const [usage, setUsage] = useState(EMPTY_SESSION_USAGE);
  const callIds = useMemo(() => extractAiCallIds(messages), [messages]);
  const callKey = callIds.join(",");

  useEffect(() => {
    if (chatPending || callIds.length === 0) {
      if (callIds.length === 0) setUsage(EMPTY_SESSION_USAGE);
      return;
    }
    let cancelled = false;
    fetch(`/api/control/usage?calls=${encodeURIComponent(callKey)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: SessionUsage | null) => {
        if (!cancelled && data) setUsage(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // callKey is the stable serialization of callIds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callKey, chatPending]);

  return usage;
}
