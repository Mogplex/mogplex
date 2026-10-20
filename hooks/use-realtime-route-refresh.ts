"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useUser } from "@/hooks/use-user";
import { useTableEvents } from "@/hooks/use-table-events";

export type RealtimeRefreshSpec = {
  table: string;
  event?: "*" | "INSERT" | "UPDATE" | "DELETE";
  schema?: string;
  filter?: string;
};

function resolveSpecs(
  specs: RealtimeRefreshSpec[],
  userId: string | null | undefined
) {
  return specs.flatMap((spec) => {
    if (!spec.filter?.includes("$USER_ID")) return [spec];
    if (!userId) return [];

    return [
      {
        ...spec,
        filter: spec.filter.replaceAll("$USER_ID", userId),
      },
    ];
  });
}

export function useRealtimeRouteRefresh({
  channelName,
  specs,
  onInvalidate,
  enabled = true,
  onConnectionChange,
}: {
  channelName: string;
  specs: RealtimeRefreshSpec[];
  onInvalidate: () => void | Promise<unknown>;
  enabled?: boolean;
  onConnectionChange?: (
    state: "connecting" | "connected" | "disconnected"
  ) => void;
}) {
  const { user } = useUser();
  const invalidateRef = useRef(onInvalidate);
  const connectionRef = useRef(onConnectionChange);
  const scheduledRef = useRef(false);
  const specsKey = JSON.stringify(specs);

  useEffect(() => {
    invalidateRef.current = onInvalidate;
    connectionRef.current = onConnectionChange;
  }, [onInvalidate, onConnectionChange]);

  const resolvedSpecs = useMemo(() => {
    const parsedSpecs = JSON.parse(specsKey) as RealtimeRefreshSpec[];
    return resolveSpecs(parsedSpecs, user?.id);
  }, [specsKey, user?.id]);

  const tables = useMemo(() => {
    const tables = new Set<string>();
    for (const spec of specs) {
      tables.add(spec.table);
    }
    return [...tables];
  }, [specs]);

  const scheduleInvalidate = useCallback(() => {
    if (scheduledRef.current) return;
    scheduledRef.current = true;
    queueMicrotask(() => {
      scheduledRef.current = false;
      void Promise.resolve(invalidateRef.current()).catch((error) => {
        console.error(
          `[realtime-route-refresh] ${channelName} invalidate failed`,
          error
        );
      });
    });
  }, [channelName]);

  useTableEvents({
    tables,
    enabled: enabled && resolvedSpecs.length > 0,
    onEvent: scheduleInvalidate,
    onConnectionChange: (state) => {
      connectionRef.current?.(state);
      if (state === "connected") scheduleInvalidate();
    },
  });
}
