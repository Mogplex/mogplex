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
  onConnectionChange?: (
    state: "connecting" | "connected" | "disconnected"
  ) => void;
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
  onConnectionChange,
}: UseTableEventsOptions): void {
  const onEventRef = useRef(onEvent);
  const connectionRef = useRef(onConnectionChange);

  useEffect(() => {
    onEventRef.current = onEvent;
    connectionRef.current = onConnectionChange;
  }, [onEvent, onConnectionChange]);

  const tablesKey = tables.slice().sort().join(",");

  useEffect(() => {
    if (!enabled || tables.length === 0) return;

    const url = `/api/realtime/events?tables=${encodeURIComponent(tablesKey)}`;
    const eventSource = new EventSource(url);
    connectionRef.current?.("connecting");
    const handleOpen = () => connectionRef.current?.("connected");

    const handleMessage = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data as string) as TableEvent;
        onEventRef.current(payload);
      } catch {
        // Malformed message, skip
      }
    };

    const handleError = () => {
      connectionRef.current?.("disconnected");
    };

    eventSource.addEventListener("message", handleMessage);
    eventSource.addEventListener("open", handleOpen);
    eventSource.addEventListener("error", handleError);

    return () => {
      eventSource.removeEventListener("message", handleMessage);
      eventSource.removeEventListener("open", handleOpen);
      eventSource.removeEventListener("error", handleError);
      eventSource.close();
    };
  }, [enabled, tablesKey, tables.length]);
}
