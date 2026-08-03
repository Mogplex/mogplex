"use client";

import { useEffect, useRef } from "react";

export type TableEvent = {
  table: string;
  op: string;
};

export type UseTableEventsOptions = {
  tables: string[];
  enabled?: boolean;
  onEvent: (event: TableEvent) => void;
};

/**
 * Subscribe to Neon table events via SSE.
 *
 * This hook connects to /api/realtime/events and receives events when any of
 * the specified tables change. The server filters events to only include those
 * for the authenticated user (or broadcast events with no user scope).
 *
 * EventSource auto-reconnects on disconnect; no manual retry logic needed.
 */
export function useTableEvents({
  tables,
  enabled = true,
  onEvent,
}: UseTableEventsOptions): void {
  const onEventRef = useRef(onEvent);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  const tablesKey = tables.slice().sort().join(",");

  useEffect(() => {
    if (!enabled || tables.length === 0) return;

    const url = `/api/realtime/events?tables=${encodeURIComponent(tablesKey)}`;
    const eventSource = new EventSource(url);

    const handleMessage = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data as string) as TableEvent;
        onEventRef.current(payload);
      } catch {
        // Malformed message, skip
      }
    };

    const handleError = () => {
      // EventSource auto-reconnects, no action needed
    };

    eventSource.addEventListener("message", handleMessage);
    eventSource.addEventListener("error", handleError);

    return () => {
      eventSource.removeEventListener("message", handleMessage);
      eventSource.removeEventListener("error", handleError);
      eventSource.close();
    };
  }, [enabled, tablesKey, tables.length]);
}
