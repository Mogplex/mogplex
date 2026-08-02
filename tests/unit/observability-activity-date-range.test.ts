import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTIVITY_DATE_RANGE_PRESET_OPTIONS,
  DEFAULT_ACTIVITY_DATE_RANGE_PRESET,
  buildActivityDateRangeHref,
  isCustomRangeIncomplete,
  readActivityDateRangeSelection,
  resolveActivityDateRange,
} from "../../lib/observability/activity-date-range";

function paramsFromString(query: string) {
  return new URLSearchParams(query);
}

test("ACTIVITY_DATE_RANGE_PRESET_OPTIONS exposes the requested preset surface", () => {
  assert.deepEqual(
    ACTIVITY_DATE_RANGE_PRESET_OPTIONS.map((option) => option.value),
    ["today", "7d", "30d", "mtd", "prev_month", "custom"]
  );
});

test("DEFAULT_ACTIVITY_DATE_RANGE_PRESET defaults to past 7 days per spec", () => {
  assert.equal(DEFAULT_ACTIVITY_DATE_RANGE_PRESET, "7d");
});

test("resolveActivityDateRange computes ranges for each preset", () => {
  const now = new Date("2026-04-15T12:00:00.000Z");
  const todayLocalStart = new Date(now);
  todayLocalStart.setHours(0, 0, 0, 0);
  const monthStartLocal = new Date(
    now.getFullYear(),
    now.getMonth(),
    1,
    0,
    0,
    0,
    0
  );
  const prevMonthStartLocal = new Date(
    now.getFullYear(),
    now.getMonth() - 1,
    1,
    0,
    0,
    0,
    0
  );
  const prevMonthEndLocal = new Date(monthStartLocal.getTime() - 1);

  assert.deepEqual(resolveActivityDateRange("today", {}, now), {
    from: todayLocalStart.toISOString(),
  });
  assert.deepEqual(resolveActivityDateRange("7d", {}, now), {
    from: "2026-04-08T12:00:00.000Z",
  });
  assert.deepEqual(resolveActivityDateRange("30d", {}, now), {
    from: "2026-03-16T12:00:00.000Z",
  });
  assert.deepEqual(resolveActivityDateRange("mtd", {}, now), {
    from: monthStartLocal.toISOString(),
  });
  assert.deepEqual(resolveActivityDateRange("prev_month", {}, now), {
    from: prevMonthStartLocal.toISOString(),
    to: prevMonthEndLocal.toISOString(),
  });
});

test("resolveActivityDateRange normalizes custom ISO inputs and ignores bad values", () => {
  const now = new Date("2026-04-15T12:00:00.000Z");

  assert.deepEqual(
    resolveActivityDateRange(
      "custom",
      { from: "2026-04-01T00:00:00Z", to: "not-a-date" },
      now
    ),
    {
      from: "2026-04-01T00:00:00.000Z",
      to: undefined,
    }
  );
});

test("readActivityDateRangeSelection defaults to 7d when nothing is set", () => {
  assert.deepEqual(readActivityDateRangeSelection(paramsFromString("")), {
    preset: "7d",
    custom: {},
  });
});

test("readActivityDateRangeSelection parses preset values and ignores invalid ones", () => {
  assert.equal(
    readActivityDateRangeSelection(paramsFromString("range=30d")).preset,
    "30d"
  );
  assert.equal(
    readActivityDateRangeSelection(paramsFromString("range=bogus")).preset,
    "7d"
  );
});

test("readActivityDateRangeSelection preserves range=custom even when bounds are not set yet", () => {
  // Regression: switching the picker to Custom writes ?range=custom before
  // any bounds exist; the parser must not silently revert to the default,
  // otherwise the UI can never enter custom-input mode.
  assert.deepEqual(
    readActivityDateRangeSelection(paramsFromString("range=custom")),
    { preset: "custom", custom: { from: undefined, to: undefined } }
  );
});

test("readActivityDateRangeSelection treats explicit from/to as a custom range", () => {
  const selection = readActivityDateRangeSelection(
    paramsFromString("from=2026-04-01T00:00:00Z&to=2026-04-10T23:59:59Z")
  );
  assert.equal(selection.preset, "custom");
  assert.equal(selection.custom.from, "2026-04-01T00:00:00.000Z");
  assert.equal(selection.custom.to, "2026-04-10T23:59:59.000Z");
});

test("buildActivityDateRangeHref omits range param for the default preset and clears stale custom values", () => {
  assert.equal(
    buildActivityDateRangeHref(paramsFromString("range=30d&from=x&to=y"), {
      preset: "7d",
      custom: {},
    }),
    "/observability"
  );
});

test("buildActivityDateRangeHref preserves unrelated query params", () => {
  assert.equal(
    buildActivityDateRangeHref(paramsFromString("repo_id=r1&range=7d"), {
      preset: "30d",
      custom: {},
    }),
    "/observability?repo_id=r1&range=30d"
  );
});

test("buildActivityDateRangeHref serializes custom ranges with from/to", () => {
  assert.equal(
    buildActivityDateRangeHref(paramsFromString(""), {
      preset: "custom",
      custom: {
        from: "2026-04-01T00:00:00.000Z",
        to: "2026-04-10T00:00:00.000Z",
      },
    }),
    "/observability?range=custom&from=2026-04-01T00%3A00%3A00.000Z&to=2026-04-10T00%3A00%3A00.000Z"
  );
});

test("isCustomRangeIncomplete returns true only for custom presets without bounds", () => {
  assert.equal(isCustomRangeIncomplete({ preset: "custom", custom: {} }), true);
  assert.equal(
    isCustomRangeIncomplete({
      preset: "custom",
      custom: { from: "2026-04-01T00:00:00.000Z" },
    }),
    false
  );
  assert.equal(isCustomRangeIncomplete({ preset: "7d", custom: {} }), false);
});
