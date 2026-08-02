"use client";

import { useCallback, useState } from "react";
import type { AutomationFailuresFilters } from "@/hooks/use-observability";

const INITIAL_AUTOMATION_FAILURE_FILTERS: AutomationFailuresFilters = {
  page: 1,
  limit: 25,
};

export function createInitialAutomationFailureFilters(): AutomationFailuresFilters {
  return { ...INITIAL_AUTOMATION_FAILURE_FILTERS };
}

export function mergeUpdatedAutomationFailureFilters<
  K extends keyof AutomationFailuresFilters,
>(
  prev: AutomationFailuresFilters,
  key: K,
  value: AutomationFailuresFilters[K]
): AutomationFailuresFilters {
  return {
    ...prev,
    [key]: value,
    page: key === "page" ? (value as number) : 1,
  };
}

export function useObservabilityAutomationFailureFilters() {
  const [automationFailureFilters, setAutomationFailureFilters] =
    useState<AutomationFailuresFilters>(() =>
      createInitialAutomationFailureFilters()
    );

  const updateAutomationFailureFilter = useCallback(
    <K extends keyof AutomationFailuresFilters>(
      key: K,
      value: AutomationFailuresFilters[K]
    ) => {
      setAutomationFailureFilters((prev) =>
        mergeUpdatedAutomationFailureFilters(prev, key, value)
      );
    },
    []
  );

  return {
    automationFailureFilters,
    setAutomationFailureFilters,
    updateAutomationFailureFilter,
  };
}
