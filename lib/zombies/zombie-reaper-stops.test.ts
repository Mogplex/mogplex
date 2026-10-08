import { describe, expect, it } from "vitest";
import { forEachConcurrently } from "./zombie-reaper-stops";

describe("forEachConcurrently", () => {
  it("should process every item with no more than the limit in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    const seen: number[] = [];
    await forEachConcurrently([1, 2, 3, 4, 5, 6, 7], 3, async (item) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      seen.push(item);
      inFlight -= 1;
    });
    expect(seen.toSorted((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(peak).toBe(3);
  });

  it("should do nothing for no items", async () => {
    let calls = 0;
    await forEachConcurrently([], 3, async () => {
      calls += 1;
    });
    expect(calls).toBe(0);
  });
});
