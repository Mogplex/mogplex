export type ActivityDateRangePreset =
  | "today"
  | "7d"
  | "30d"
  | "mtd"
  | "prev_month"
  | "custom";

export type ResolvedActivityDateRange = {
  from?: string;
  to?: string;
};

export type ActivityDateRangeSelection = {
  preset: ActivityDateRangePreset;
  custom: ResolvedActivityDateRange;
};

export const ACTIVITY_DATE_RANGE_PRESET_OPTIONS: ReadonlyArray<{
  value: ActivityDateRangePreset;
  label: string;
}> = [
  { value: "today", label: "Today" },
  { value: "7d", label: "Past 7 days" },
  { value: "30d", label: "Past 30 days" },
  { value: "mtd", label: "Current month" },
  { value: "prev_month", label: "Previous month" },
  { value: "custom", label: "Custom range" },
];

export const DEFAULT_ACTIVITY_DATE_RANGE_PRESET: ActivityDateRangePreset = "7d";

const ACTIVITY_DATE_RANGE_PRESET_VALUES: ReadonlySet<ActivityDateRangePreset> =
  new Set(ACTIVITY_DATE_RANGE_PRESET_OPTIONS.map((opt) => opt.value));

export function isActivityDateRangePreset(
  value: unknown
): value is ActivityDateRangePreset {
  return (
    typeof value === "string" &&
    ACTIVITY_DATE_RANGE_PRESET_VALUES.has(value as ActivityDateRangePreset)
  );
}

function normalizeIsoBoundary(
  value: string | null | undefined
): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

export function resolveActivityDateRange(
  preset: ActivityDateRangePreset,
  custom: ResolvedActivityDateRange = {},
  now: Date = new Date()
): ResolvedActivityDateRange {
  const day = 86_400_000;

  if (preset === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return { from: start.toISOString() };
  }

  if (preset === "7d") {
    return { from: new Date(now.getTime() - 7 * day).toISOString() };
  }

  if (preset === "30d") {
    return { from: new Date(now.getTime() - 30 * day).toISOString() };
  }

  if (preset === "mtd") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    return { from: start.toISOString() };
  }

  if (preset === "prev_month") {
    const start = new Date(
      now.getFullYear(),
      now.getMonth() - 1,
      1,
      0,
      0,
      0,
      0
    );
    const nextMonth = new Date(
      now.getFullYear(),
      now.getMonth(),
      1,
      0,
      0,
      0,
      0
    );
    return {
      from: start.toISOString(),
      to: new Date(nextMonth.getTime() - 1).toISOString(),
    };
  }

  return {
    from: normalizeIsoBoundary(custom.from),
    to: normalizeIsoBoundary(custom.to),
  };
}

type SearchParamsLike = {
  get: (name: string) => string | null;
  toString: () => string;
};

export function readActivityDateRangeSelection(
  searchParams: SearchParamsLike
): ActivityDateRangeSelection {
  const rangeRaw = searchParams.get("range");
  const fromRaw = searchParams.get("from");
  const toRaw = searchParams.get("to");
  const from = normalizeIsoBoundary(fromRaw);
  const to = normalizeIsoBoundary(toRaw);

  if (rangeRaw === "custom") {
    return { preset: "custom", custom: { from, to } };
  }

  if (rangeRaw == null && (from || to)) {
    return { preset: "custom", custom: { from, to } };
  }

  if (isActivityDateRangePreset(rangeRaw)) {
    return { preset: rangeRaw, custom: {} };
  }

  return { preset: DEFAULT_ACTIVITY_DATE_RANGE_PRESET, custom: {} };
}

export function buildActivityDateRangeHref(
  searchParams: SearchParamsLike,
  selection: ActivityDateRangeSelection,
  basePath = "/observability"
): string {
  const params = new URLSearchParams(searchParams.toString());
  params.delete("range");
  params.delete("from");
  params.delete("to");

  if (selection.preset === "custom") {
    params.set("range", "custom");
    if (selection.custom.from) params.set("from", selection.custom.from);
    if (selection.custom.to) params.set("to", selection.custom.to);
  } else if (selection.preset !== DEFAULT_ACTIVITY_DATE_RANGE_PRESET) {
    params.set("range", selection.preset);
  }

  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

export function isCustomRangeIncomplete(
  selection: ActivityDateRangeSelection
): boolean {
  return (
    selection.preset === "custom" &&
    !selection.custom.from &&
    !selection.custom.to
  );
}
