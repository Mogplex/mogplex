import { describe, expect, it } from "vitest";
import {
  buildReservedCheckoutPath,
  isStaleWorktreeReservation,
  staleWorktreeReservationCutoff,
} from "./store";

describe("staleWorktreeReservationCutoff", () => {
  it("allows a creating reservation to be reclaimed after five minutes", () => {
    expect(
      staleWorktreeReservationCutoff(Date.parse("2026-08-13T00:05:00.000Z"))
    ).toBe("2026-08-13T00:00:00.000Z");
    expect(
      isStaleWorktreeReservation(
        "2026-08-12T23:59:59.999Z",
        Date.parse("2026-08-13T00:05:00.000Z")
      )
    ).toBe(true);
  });

  it("builds a constraint-safe placeholder with a repository path segment", () => {
    expect(
      buildReservedCheckoutPath("11111111-2222-4333-8444-555555555555")
    ).toBe("/.reserved/.worktrees/11111111-2222-4333-8444-555555555555");
  });
});
