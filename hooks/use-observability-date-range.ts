"use client";

import { useCallback, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type {
  AutomationFailuresFilters,
  AutomationEventsFilters,
  CallsFilters,
  JobsFilters,
} from "@/hooks/use-observability";

export type ObservabilityDateRangePreset = "" | "1h" | "today" | "7d" | "30d";

type ObservabilityDateRange = {
  from?: string;
  to?: string;
};

type ObservabilityDateRangeSetters = {
  setJobFilters: Dispatch<SetStateAction<JobsFilters>>;
  setCallFilters: Dispatch<SetStateAction<CallsFilters>>;
  setPressureFilters: Dispatch<SetStateAction<AutomationEventsFilters>>;
  setAutomationFailureFilters: Dispatch<
    SetStateAction<AutomationFailuresFilters>
  >;
};

export function resolveObservabilityDateRange(
  preset: ObservabilityDateRangePreset,
  now = new Date()
): ObservabilityDateRange {
  if (preset === "1h") {
    return { from: new Date(now.getTime() - 3600000).toISOString() };
  }

  if (preset === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return { from: start.toISOString() };
  }

  if (preset === "7d") {
    return { from: new Date(now.getTime() - 7 * 86400000).toISOString() };
  }

  if (preset === "30d") {
    return { from: new Date(now.getTime() - 30 * 86400000).toISOString() };
  }

  return {};
}

export function applyObservabilityDateRangePreset(
  preset: ObservabilityDateRangePreset,
  {
    setDatePreset,
    setJobFilters,
    setCallFilters,
    setPressureFilters,
    setAutomationFailureFilters,
  }: ObservabilityDateRangeSetters & {
    setDatePreset: Dispatch<SetStateAction<ObservabilityDateRangePreset>>;
  },
  now = new Date()
) {
  const range = resolveObservabilityDateRange(preset, now);

  setDatePreset(preset);
  setJobFilters((prev) => ({
    ...prev,
    from: range.from,
    to: range.to,
    page: 1,
  }));
  setCallFilters((prev) => ({
    ...prev,
    from: range.from,
    to: range.to,
    page: 1,
  }));
  setPressureFilters((prev) => ({
    ...prev,
    from: range.from,
    to: range.to,
    page: 1,
  }));
  setAutomationFailureFilters((prev) => ({
    ...prev,
    from: range.from,
    to: range.to,
    page: 1,
  }));
}

export function useObservabilityDateRange({
  setJobFilters,
  setCallFilters,
  setPressureFilters,
  setAutomationFailureFilters,
}: ObservabilityDateRangeSetters) {
  const [datePreset, setDatePreset] =
    useState<ObservabilityDateRangePreset>("");

  const applyDateRange = useCallback(
    (preset: ObservabilityDateRangePreset) => {
      applyObservabilityDateRangePreset(preset, {
        setDatePreset,
        setJobFilters,
        setCallFilters,
        setPressureFilters,
        setAutomationFailureFilters,
      });
    },
    [
      setAutomationFailureFilters,
      setCallFilters,
      setJobFilters,
      setPressureFilters,
    ]
  );

  return {
    datePreset,
    applyDateRange,
  };
}
