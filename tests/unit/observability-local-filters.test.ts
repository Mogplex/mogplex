import assert from "node:assert/strict";
import test from "node:test";
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
import type { AutomationFailuresFilters } from "../../hooks/use-observability";

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
