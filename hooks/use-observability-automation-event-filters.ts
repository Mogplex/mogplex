"use client";

import { useCallback, useState } from "react";
import type { AutomationEventsFilters } from "@/hooks/use-observability";

const INITIAL_PRESSURE_FILTERS: AutomationEventsFilters = {
  page: 1,
  limit: 25,
};

export function createInitialPressureFilters(): AutomationEventsFilters {
  return { ...INITIAL_PRESSURE_FILTERS };
}

export function mergeUpdatedPressureFilters<
  K extends keyof AutomationEventsFilters,
>(
  prev: AutomationEventsFilters,
  key: K,
  value: AutomationEventsFilters[K]
): AutomationEventsFilters {
  return {
    ...prev,
    [key]: value,
    page: key === "page" ? (value as number) : 1,
  };
}

export function useObservabilityAutomationEventFilters() {
  const [pressureFilters, setPressureFilters] =
    useState<AutomationEventsFilters>(() => createInitialPressureFilters());

  const updatePressureFilter = useCallback(
    <K extends keyof AutomationEventsFilters>(
      key: K,
      value: AutomationEventsFilters[K]
    ) => {
      setPressureFilters((prev) =>
        mergeUpdatedPressureFilters(prev, key, value)
      );
    },
    []
  );

  return {
    pressureFilters,
    setPressureFilters,
    updatePressureFilter,
  };
}
