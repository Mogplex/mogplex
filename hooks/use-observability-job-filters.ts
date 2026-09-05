"use client";

import { useCallback, useMemo, type SetStateAction } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  readWorkFilters,
  writeWorkFilters,
} from "@/lib/observability/work-route";
import type { JobsFilters } from "@/hooks/use-observability";

const INITIAL_JOB_FILTERS: JobsFilters = {
  page: 1,
  limit: 25,
  sort: "created_at",
  order: "desc",
};

export function createInitialJobFilters(): JobsFilters {
  return { ...INITIAL_JOB_FILTERS };
}

export function mergeUpdatedJobFilters<K extends keyof JobsFilters>(
  prev: JobsFilters,
  key: K,
  value: JobsFilters[K]
): JobsFilters {
  return {
    ...prev,
    [key]: value,
    page: key === "page" ? (value as number) : 1,
  };
}

export function useObservabilityJobFilters() {
  const params = useSearchParams();
  const pathname = usePathname();
  const jobFilters = useMemo(
    () => readWorkFilters(new URLSearchParams(params)),
    [params]
  );
  const setJobFilters = useCallback(
    (update: SetStateAction<JobsFilters>) => {
      // These filters only drive client queries. Native history updates the URL
      // synchronously and Next's useSearchParams subscription follows it, so a
      // second control cannot overwrite a still-pending router transition.
      const current = new URLSearchParams(window.location.search);
      const next =
        typeof update === "function"
          ? update(readWorkFilters(current))
          : update;
      window.history.replaceState(
        null,
        "",
        `${pathname}?${writeWorkFilters(current, next)}`
      );
    },
    [pathname]
  );

  const updateJobFilter = useCallback(
    <K extends keyof JobsFilters>(key: K, value: JobsFilters[K]) => {
      setJobFilters((prev) => mergeUpdatedJobFilters(prev, key, value));
    },
    [setJobFilters]
  );

  return {
    jobFilters,
    setJobFilters,
    updateJobFilter,
  };
}
