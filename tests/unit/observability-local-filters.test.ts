import assert from "node:assert/strict";
import test from "node:test";
import {
  applyObservabilityDateRangePreset,
  resolveObservabilityDateRange,
} from "../../hooks/use-observability-date-range";
import {
  createInitialJobFilters,
  mergeUpdatedJobFilters,
} from "../../hooks/use-observability-job-filters";
import {
  createInitialPressureFilters,
  mergeUpdatedPressureFilters,
} from "../../hooks/use-observability-automation-event-filters";
import {
  createInitialAutomationFailureFilters,
  mergeUpdatedAutomationFailureFilters,
} from "../../hooks/use-observability-automation-failure-filters";
import type { ObservabilityDateRangePreset } from "../../hooks/use-observability-date-range";
import type { SetStateAction } from "react";
import type {
  AutomationFailuresFilters,
  AutomationEventsFilters,
  CallsFilters,
  JobsFilters,
} from "../../hooks/use-observability";

function createStateHarness<T>(initial: T) {
  let value = initial;

  return {
    get() {
      return value;
    },
    set(next: SetStateAction<T>) {
      value =
        typeof next === "function" ? (next as (prev: T) => T)(value) : next;
    },
  };
}

test("createInitialJobFilters returns the runs defaults", () => {
  assert.deepEqual(createInitialJobFilters(), {
    page: 1,
    limit: 25,
    sort: "created_at",
    order: "desc",
  });
});

test("mergeUpdatedJobFilters resets page for non-page updates and preserves direct pagination changes", () => {
  const base = {
    page: 3,
    limit: 25,
    sort: "created_at",
    order: "desc" as const,
    status: "running",
  };

  assert.deepEqual(mergeUpdatedJobFilters(base, "status", "failed"), {
    ...base,
    status: "failed",
    page: 1,
  });

  assert.deepEqual(mergeUpdatedJobFilters(base, "page", 5), {
    ...base,
    page: 5,
  });
});

test("createInitialPressureFilters returns the pressure defaults", () => {
  assert.deepEqual(createInitialPressureFilters(), {
    page: 1,
    limit: 25,
  });
});

test("mergeUpdatedPressureFilters resets page for non-page updates and preserves direct pagination changes", () => {
  const base = {
    page: 4,
    limit: 25,
    outcome: "started",
  };

  assert.deepEqual(mergeUpdatedPressureFilters(base, "outcome", "deferred"), {
    ...base,
    outcome: "deferred",
    page: 1,
  });

  assert.deepEqual(mergeUpdatedPressureFilters(base, "page", 2), {
    ...base,
    page: 2,
  });
});

test("createInitialAutomationFailureFilters returns the automation failure defaults", () => {
  assert.deepEqual(createInitialAutomationFailureFilters(), {
    page: 1,
    limit: 25,
  });
});

test("mergeUpdatedAutomationFailureFilters resets page for non-page updates and preserves direct pagination changes", () => {
  const base = {
    page: 5,
    limit: 25,
    failureClass: "timeout",
  } satisfies AutomationFailuresFilters;

  assert.deepEqual(
    mergeUpdatedAutomationFailureFilters(base, "provider", "openai"),
    {
      ...base,
      provider: "openai",
      page: 1,
    }
  );

  assert.deepEqual(mergeUpdatedAutomationFailureFilters(base, "page", 3), {
    ...base,
    page: 3,
  });
});

test("resolveObservabilityDateRange returns the expected ranges for each preset", () => {
  const now = new Date("2026-04-01T15:30:00.000Z");
  const localStartOfDay = new Date(now);
  localStartOfDay.setHours(0, 0, 0, 0);

  assert.deepEqual(resolveObservabilityDateRange("", now), {});
  assert.deepEqual(resolveObservabilityDateRange("1h", now), {
    from: "2026-04-01T14:30:00.000Z",
  });
  assert.deepEqual(resolveObservabilityDateRange("today", now), {
    from: localStartOfDay.toISOString(),
  });
  assert.deepEqual(resolveObservabilityDateRange("7d", now), {
    from: "2026-03-25T15:30:00.000Z",
  });
  assert.deepEqual(resolveObservabilityDateRange("30d", now), {
    from: "2026-03-02T15:30:00.000Z",
  });
});

test("applyObservabilityDateRangePreset updates all observability filters and resets pagination", () => {
  const now = new Date("2026-04-01T15:30:00.000Z");
  const presetHarness = createStateHarness<ObservabilityDateRangePreset>("");
  const jobFiltersHarness = createStateHarness<JobsFilters>({
    page: 3,
    limit: 25,
    sort: "created_at",
    order: "desc",
    status: "running",
  });
  const callFiltersHarness = createStateHarness<CallsFilters>({
    page: 2,
    limit: 50,
    sort: "started_at",
    order: "desc",
    repoId: "repo_123",
  });
  const pressureFiltersHarness = createStateHarness<AutomationEventsFilters>({
    page: 4,
    limit: 25,
    outcome: "started",
  });
  const automationFailureFiltersHarness =
    createStateHarness<AutomationFailuresFilters>({
      page: 6,
      limit: 25,
      failureClass: "timeout",
    });

  applyObservabilityDateRangePreset(
    "7d",
    {
      setDatePreset: presetHarness.set,
      setJobFilters: jobFiltersHarness.set,
      setCallFilters: callFiltersHarness.set,
      setPressureFilters: pressureFiltersHarness.set,
      setAutomationFailureFilters: automationFailureFiltersHarness.set,
    },
    now
  );

  assert.equal(presetHarness.get(), "7d");
  assert.deepEqual(jobFiltersHarness.get(), {
    page: 1,
    limit: 25,
    sort: "created_at",
    order: "desc",
    status: "running",
    from: "2026-03-25T15:30:00.000Z",
    to: undefined,
  });
  assert.deepEqual(callFiltersHarness.get(), {
    page: 1,
    limit: 50,
    sort: "started_at",
    order: "desc",
    repoId: "repo_123",
    from: "2026-03-25T15:30:00.000Z",
    to: undefined,
  });
  assert.deepEqual(pressureFiltersHarness.get(), {
    page: 1,
    limit: 25,
    outcome: "started",
    from: "2026-03-25T15:30:00.000Z",
    to: undefined,
  });
  assert.deepEqual(automationFailureFiltersHarness.get(), {
    page: 1,
    limit: 25,
    failureClass: "timeout",
    from: "2026-03-25T15:30:00.000Z",
    to: undefined,
  });
});
