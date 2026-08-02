"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  buildClearedCallFilterHref,
  buildCurrentObservabilityCallHref,
  buildClearedRepoCallFilterHref,
  buildClearedSandboxCallFilterHref,
  buildSelectedCallFilterHref,
  readObservabilityCallRouteFilters,
} from "@/lib/observability/call-route-filters";
import type { SetStateAction } from "react";
import type { CallsFilters } from "@/hooks/use-observability";

const INITIAL_CALL_FILTERS = {
  page: 1,
  limit: 50,
  sort: "started_at",
  order: "desc" as const,
};

export function useObservabilityCallFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const routeFilters = useMemo(
    () => readObservabilityCallRouteFilters(searchParams),
    [searchParams]
  );
  const selectedCallHref = useMemo(
    () =>
      routeFilters.callId
        ? buildCurrentObservabilityCallHref(searchParams)
        : null,
    [routeFilters.callId, searchParams]
  );

  const [localCallFilters, setLocalCallFilters] = useState<
    Omit<CallsFilters, "repoId" | "sandboxRecordId">
  >(() => ({ ...INITIAL_CALL_FILTERS }));

  const callFilters = useMemo<CallsFilters>(
    () => ({
      ...localCallFilters,
      repoId: routeFilters.repoId,
      sandboxRecordId: routeFilters.sandboxRecordId,
    }),
    [localCallFilters, routeFilters.repoId, routeFilters.sandboxRecordId]
  );

  const setCallFilters = useCallback(
    (updater: SetStateAction<CallsFilters>) => {
      setLocalCallFilters((prev) => {
        const current: CallsFilters = {
          ...prev,
          repoId: routeFilters.repoId,
          sandboxRecordId: routeFilters.sandboxRecordId,
        };
        const next = typeof updater === "function" ? updater(current) : updater;

        return {
          page: next.page,
          limit: next.limit,
          sort: next.sort,
          order: next.order,
          liveOnly: next.liveOnly,
          type: next.type,
          model: next.model,
          status: next.status,
          from: next.from,
          to: next.to,
          conversationId: next.conversationId,
          agentId: next.agentId,
        };
      });
    },
    [routeFilters.repoId, routeFilters.sandboxRecordId]
  );

  const updateCallFilter = useCallback(
    <K extends keyof CallsFilters>(key: K, value: CallsFilters[K]) => {
      setCallFilters((prev) => ({
        ...prev,
        [key]: value,
        page: key === "page" ? (value as number) : 1,
      }));
    },
    [setCallFilters]
  );

  const clearRepoCallFilter = useCallback(() => {
    setLocalCallFilters((prev) => ({ ...prev, page: 1 }));
    router.replace(buildClearedRepoCallFilterHref(searchParams));
  }, [router, searchParams]);

  const clearSandboxCallFilter = useCallback(() => {
    setLocalCallFilters((prev) => ({ ...prev, page: 1 }));
    router.replace(buildClearedSandboxCallFilterHref(searchParams));
  }, [router, searchParams]);

  const setSelectedCallId = useCallback(
    (callId?: string | null) => {
      if (callId) {
        router.replace(buildSelectedCallFilterHref(searchParams, callId));
        return;
      }

      router.replace(buildClearedCallFilterHref(searchParams));
    },
    [router, searchParams]
  );

  const clearSelectedCallId = useCallback(() => {
    router.replace(buildClearedCallFilterHref(searchParams));
  }, [router, searchParams]);

  const copySelectedCallLink = useCallback(async () => {
    if (
      !selectedCallHref ||
      typeof window === "undefined" ||
      typeof navigator === "undefined"
    ) {
      return false;
    }

    if (typeof navigator.clipboard?.writeText !== "function") {
      return false;
    }

    try {
      await navigator.clipboard.writeText(
        new URL(selectedCallHref, window.location.origin).toString()
      );
      return true;
    } catch {
      return false;
    }
  }, [selectedCallHref]);

  return {
    callFilters,
    selectedCallId: routeFilters.callId,
    selectedCallHref,
    setCallFilters,
    updateCallFilter,
    clearRepoCallFilter,
    clearSandboxCallFilter,
    setSelectedCallId,
    clearSelectedCallId,
    copySelectedCallLink,
  };
}
