import { describe, expect, it } from "vitest";
import {
  defaultDirectionFor,
  filterCatalog,
  formatContextLength,
  formatPerMillion,
  sortCatalog,
  timeAgo,
  type CatalogRow,
} from "./model-catalog-view";

function row(
  overrides: Partial<CatalogRow> & Pick<CatalogRow, "id">
): CatalogRow {
  return {
    provider: "openai",
    name: overrides.id,
    context_length: 128_000,
    pricing_input: 0.000001,
    pricing_output: 0.000004,
    capabilities: [],
    is_available: true,
    is_enabled: true,
    ...overrides,
  };
}

const rows = [
  row({ id: "openai/a", name: "Alpha", pricing_input: 0.0000025 }),
  row({
    id: "anthropic/b",
    name: "Beta",
    provider: "anthropic",
    is_enabled: false,
    pricing_input: null,
    pricing_output: null,
  }),
  row({
    id: "openai/c",
    name: "Gamma",
    context_length: 1_000_000,
    capabilities: ["vision"],
    is_available: false,
  }),
];

describe("model catalog formatting", () => {
  it("formats context windows in k and M", () => {
    expect(formatContextLength(null)).toBe("—");
    expect(formatContextLength(128_000)).toBe("128k");
    expect(formatContextLength(1_000_000)).toBe("1M");
    expect(formatContextLength(1_500_000)).toBe("1.5M");
  });

  it("formats per-token prices per million tokens", () => {
    expect(formatPerMillion(undefined)).toBe("—");
    expect(formatPerMillion(0.0000025)).toBe("$2.50");
    expect(formatPerMillion(0.000075)).toBe("$75");
    expect(formatPerMillion(0.0000001)).toBe("$0.1");
  });

  it("describes recommendation freshness relative to now", () => {
    expect(timeAgo(null)).toBeNull();
    expect(timeAgo(new Date(Date.now() - 90_000).toISOString())).toBe("1m ago");
    expect(timeAgo(new Date(Date.now() - 3 * 86_400_000).toISOString())).toBe(
      "3d ago"
    );
  });
});

describe("model catalog filtering", () => {
  const all = {
    search: "",
    provider: "all",
    state: "all",
    pricing: "all",
  } as const;

  it("matches search against provider, name, id, and capabilities", () => {
    expect(
      filterCatalog(rows, { ...all, search: "vision" }, "").map((r) => r.id)
    ).toEqual(["openai/c"]);
    expect(
      filterCatalog(rows, { ...all, search: "ANTHROPIC" }, "").map((r) => r.id)
    ).toEqual(["anthropic/b"]);
  });

  it("filters by provider, enabled state, primary, and pricing", () => {
    expect(
      filterCatalog(rows, { ...all, provider: "openai" }, "")
    ).toHaveLength(2);
    expect(
      filterCatalog(rows, { ...all, state: "disabled" }, "").map((r) => r.id)
    ).toEqual(["anthropic/b"]);
    expect(
      filterCatalog(rows, { ...all, state: "default" }, "openai/c").map(
        (r) => r.id
      )
    ).toEqual(["openai/c"]);
    expect(
      filterCatalog(rows, { ...all, pricing: "unpriced" }, "").map((r) => r.id)
    ).toEqual(["anthropic/b"]);
  });
});

describe("model catalog sorting", () => {
  it("sorts by state with the primary first and unpriced rows last", () => {
    expect(
      sortCatalog(rows, "state", "desc", "openai/c").map((r) => r.id)
    ).toEqual(["openai/c", "openai/a", "anthropic/b"]);
    expect(
      sortCatalog(rows, "pricing_input", "asc", "").map((r) => r.id)
    ).toEqual(["openai/c", "openai/a", "anthropic/b"]);
  });

  it("defaults text columns to ascending and numeric columns to descending", () => {
    expect(defaultDirectionFor("name")).toBe("asc");
    expect(defaultDirectionFor("pricing_output")).toBe("desc");
  });
});
