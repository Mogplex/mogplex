"use client";

import { useCallback, useEffect, useId, useMemo, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useUser } from "@/hooks/use-user";
import { useTableEvents } from "@/hooks/use-table-events";

export type RealtimeRefreshSpec = {
  table: string;
  event?: "*" | "INSERT" | "UPDATE" | "DELETE";
  schema?: string;
  filter?: string;
};

const useNeonBackend = process.env.NEXT_PUBLIC_MOGPLEX_DATA_BACKEND === "neon";

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
}: {
  channelName: string;
  specs: RealtimeRefreshSpec[];
  onInvalidate: () => void | Promise<unknown>;
  enabled?: boolean;
}) {
  const { user } = useUser();
  const supabase = useMemo(() => createClient(), []);
  const invalidateRef = useRef(onInvalidate);
  const scheduledRef = useRef(false);
  const channelId = useId();
  const specsKey = JSON.stringify(specs);

  useEffect(() => {
    invalidateRef.current = onInvalidate;
  }, [onInvalidate]);

  const resolvedSpecs = useMemo(() => {
    const parsedSpecs = JSON.parse(specsKey) as RealtimeRefreshSpec[];
    return resolveSpecs(parsedSpecs, user?.id);
  }, [specsKey, user?.id]);

  // Extract unique table names for Neon path
  const neonTables = useMemo(() => {
    const tables = new Set<string>();
    for (const spec of specs) {
      tables.add(spec.table);
    }
    return [...tables];
  }, [specs]);

  // Neon path: use SSE-based table events
  // (Must be called unconditionally per Rules of Hooks)
  const scheduleNeonInvalidate = useCallback(() => {
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
    tables: neonTables,
    enabled: enabled && useNeonBackend && resolvedSpecs.length > 0,
    onEvent: scheduleNeonInvalidate,
  });

  // Supabase path: existing postgres_changes subscription
  useEffect(() => {
    // Skip when Neon backend is enabled or when disabled
    if (useNeonBackend || !enabled || resolvedSpecs.length === 0) return;

    const channel = supabase.channel(`${channelName}:${channelId}`);
    const scheduleInvalidate = () => {
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
    };

    for (const spec of resolvedSpecs) {
      channel.on(
        "postgres_changes",
        {
          event: spec.event ?? "*",
          schema: spec.schema ?? "public",
          table: spec.table,
          filter: spec.filter,
        },
        scheduleInvalidate
      );
    }

    channel.subscribe((status: string, error) => {
      if (status !== "CHANNEL_ERROR" && status !== "TIMED_OUT") return;
      console.error(
        `[realtime-route-refresh] ${channelName} subscription ${status.toLowerCase()}`,
        {
          error,
          specs: resolvedSpecs,
        }
      );
    });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [channelId, channelName, enabled, resolvedSpecs, supabase]);
}
