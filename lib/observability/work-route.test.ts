import { expect, it } from "vitest";
import { readWorkFilters, readWorkView, writeWorkFilters } from "./work-route";

it("keeps legacy call deep links on Usage and honors an explicit view", () => {
  expect(readWorkView(new URLSearchParams("call_id=call"))).toBe("usage");
  expect(readWorkView(new URLSearchParams("call_id=call&view=runs"))).toBe(
    "runs"
  );
  expect(readWorkView(new URLSearchParams("view=invalid"))).toBe("runs");
});

it("round-trips run filters while retaining selection, scope-independent context and dates", () => {
  const input = new URLSearchParams(
    "run_id=run&run_kind=agent_run&range=7d&call_id=call"
  );
  const filters = {
    ...readWorkFilters(input),
    page: 3,
    status: "failed",
    sourceKind: "agent_run",
    onlyRepairable: true,
  };
  const written = writeWorkFilters(input, filters);
  expect(readWorkFilters(written)).toEqual(filters);
  for (const key of ["run_id", "run_kind", "range", "call_id"])
    expect(written.get(key)).toBe(input.get(key));
  expect(
    writeWorkFilters(written, { ...readWorkFilters(input) }).has("run_status")
  ).toBe(false);
});

it("rejects invalid pages and execution filters", () => {
  expect(
    readWorkFilters(new URLSearchParams("run_page=-1&run_status=bogus"))
  ).toMatchObject({ page: 1, status: undefined });
});
