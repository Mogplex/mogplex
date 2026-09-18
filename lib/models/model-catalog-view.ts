import type { AIModel } from "@/lib/types";

export type CatalogRow = AIModel & { is_enabled: boolean };
export type SortKey =
  | "provider"
  | "name"
  | "context_length"
  | "pricing_input"
  | "pricing_output"
  | "is_enabled"
  | "state";
export type SortDirection = "asc" | "desc";
export type ModelStateFilter = "all" | "default" | "enabled" | "disabled";
export type PricingFilter = "all" | "priced" | "unpriced";

export type CatalogFilters = {
  search: string;
  provider: string;
  state: ModelStateFilter;
  pricing: PricingFilter;
};

export function formatContextLength(value: number | null | undefined) {
  if (!value) return "—";
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M`;
  }
  return `${Math.round(value / 1000)}k`;
}

/** Formats a per-token USD price as a per-million-token price. */
export function formatPerMillion(value: number | null | undefined) {
  if (value == null) return "—";
  const perMillion = value * 1_000_000;
  const minimumFractionDigits = perMillion >= 0.1 && perMillion < 10 ? 2 : 0;
  const maximumFractionDigits =
    perMillion >= 100
      ? 0
      : perMillion >= 10
        ? 1
        : perMillion >= 1
          ? 2
          : perMillion >= 0.01
            ? 3
            : 4;
  return `$${perMillion.toLocaleString(undefined, {
    minimumFractionDigits,
    maximumFractionDigits,
  })}`;
}

export function timeAgo(dateStr: string | null | undefined) {
  if (!dateStr) return null;
  const diff = Date.now() - new Date(dateStr).getTime();
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "just now";
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  return `${Math.floor(diff / day)}d ago`;
}

function compareNullableNumbers(
  a: number | null | undefined,
  b: number | null | undefined,
  direction: SortDirection
) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return direction === "asc" ? a - b : b - a;
}

function compareStrings(a: string, b: string, direction: SortDirection) {
  return direction === "asc" ? a.localeCompare(b) : b.localeCompare(a);
}

function stateRank(model: CatalogRow, defaultModel: string) {
  if (model.id === defaultModel) return 2;
  if (model.is_enabled) return 1;
  return 0;
}

function compareState(
  left: CatalogRow,
  right: CatalogRow,
  defaultModel: string,
  direction: SortDirection
) {
  const byState = compareNullableNumbers(
    stateRank(left, defaultModel),
    stateRank(right, defaultModel),
    direction
  );
  if (byState !== 0) return byState;
  const byAvailability = compareNullableNumbers(
    Number(left.is_available),
    Number(right.is_available),
    direction
  );
  if (byAvailability !== 0) return byAvailability;
  return compareStrings(left.name, right.name, "asc");
}

export function filterCatalog(
  rows: CatalogRow[],
  filters: CatalogFilters,
  defaultModel: string
) {
  const query = filters.search.trim().toLowerCase();
  return rows.filter((model) => {
    if (
      query &&
      ![
        model.provider,
        model.name,
        model.id,
        ...(model.capabilities ?? []),
      ].some((value) => value.toLowerCase().includes(query))
    )
      return false;
    if (filters.provider !== "all" && model.provider !== filters.provider)
      return false;
    if (filters.state === "default" && model.id !== defaultModel) return false;
    if (filters.state === "enabled" && !model.is_enabled) return false;
    if (filters.state === "disabled" && model.is_enabled) return false;
    const priced = model.pricing_input != null || model.pricing_output != null;
    if (filters.pricing === "priced" && !priced) return false;
    if (filters.pricing === "unpriced" && priced) return false;
    return true;
  });
}

export function sortCatalog(
  rows: CatalogRow[],
  sortKey: SortKey,
  direction: SortDirection,
  defaultModel: string
) {
  const sorted = [...rows];
  sorted.sort((left, right) => {
    switch (sortKey) {
      case "provider":
        return compareStrings(left.provider, right.provider, direction);
      case "name":
        return compareStrings(left.name, right.name, direction);
      case "context_length":
        return compareNullableNumbers(
          left.context_length,
          right.context_length,
          direction
        );
      case "pricing_input":
        return compareNullableNumbers(
          left.pricing_input,
          right.pricing_input,
          direction
        );
      case "pricing_output":
        return compareNullableNumbers(
          left.pricing_output,
          right.pricing_output,
          direction
        );
      case "is_enabled":
        return compareNullableNumbers(
          Number(left.is_enabled),
          Number(right.is_enabled),
          direction
        );
      case "state":
        return compareState(left, right, defaultModel, direction);
      default:
        return 0;
    }
  });
  return sorted;
}

/** Default direction when a column is first selected. */
export function defaultDirectionFor(key: SortKey): SortDirection {
  return key === "name" || key === "provider" ? "asc" : "desc";
}
