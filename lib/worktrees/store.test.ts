import { describe, expect, it } from "vitest";
import { staleWorktreeReservationCutoff } from "./store";

describe("staleWorktreeReservationCutoff", () => {
  it("allows a creating reservation to be reclaimed after five minutes", () => {
    expect(
      staleWorktreeReservationCutoff(Date.parse("2026-08-13T00:05:00.000Z"))
    ).toBe("2026-08-13T00:00:00.000Z");
  });
});
