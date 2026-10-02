"use client";

import useSWR from "swr";
import { useUser } from "@/hooks/use-user";
import { useRealtimeRouteRefresh } from "@/hooks/use-realtime-route-refresh";
import { loadControlSessionList } from "./session-list-data";

const SESSION_EVENTS = [
  { table: "control_sessions", filter: "user_id=eq.$USER_ID" },
];

/** Read the sidebar's paginated list without restoring or changing a chat. */
export function useSessionSearch(open: boolean, query: string) {
  const { user } = useUser();
  const { data, error, isLoading, mutate } = useSWR(
    open && user?.id ? ["control-session-search", user.id] : null,
    () => loadControlSessionList(),
    { shouldRetryOnError: false }
  );
  useRealtimeRouteRefresh({
    channelName: "control-session-search",
    specs: SESSION_EVENTS,
    enabled: open,
    onInvalidate: mutate,
  });
  return {
    sessions: (data ?? []).filter((session) =>
      `${session.title} ${session.project ?? ""}`.toLowerCase().includes(query)
    ),
    error,
    isLoading,
    retry: () => void mutate(),
  };
}
