"use client";

import { useCallback, useState } from "react";
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
  const [jobFilters, setJobFilters] = useState<JobsFilters>(() =>
    createInitialJobFilters()
  );

  const updateJobFilter = useCallback(
    <K extends keyof JobsFilters>(key: K, value: JobsFilters[K]) => {
      setJobFilters((prev) => mergeUpdatedJobFilters(prev, key, value));
    },
    []
  );

  return {
    jobFilters,
    setJobFilters,
    updateJobFilter,
  };
}
