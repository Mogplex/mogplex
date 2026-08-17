"use client";

import { useEffect } from "react";
import { getActiveTeamRequestHeaders } from "@/components/active-scope-provider";

export function useCapacityBillingEvents(input: {
  activeTeamId: string | null;
  eventSequence: string | undefined;
  refresh: () => Promise<unknown>;
}) {
  const { activeTeamId, eventSequence, refresh } = input;

  useEffect(() => {
    if (!eventSequence) return;
    const controller = new AbortController();

    async function listen() {
      try {
        const response = await fetch(
          `/api/billing/capacity/events?after=${encodeURIComponent(eventSequence!)}`,
          {
            headers: getActiveTeamRequestHeaders(undefined, activeTeamId),
            signal: controller.signal,
          }
        );
        if (!response.ok || !response.body) return;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done || controller.signal.aborted) return;
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split("\n\n");
          buffer = events.pop() ?? "";
          if (events.some((event) => event.trim().length > 0)) {
            await refresh();
          }
        }
      } catch {
        // Keep the last durable summary. A later navigation opens a new stream.
      }
    }

    void listen();
    return () => controller.abort();
  }, [activeTeamId, eventSequence, refresh]);
}
