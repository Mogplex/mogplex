import { expect, it } from "vitest";
import { mapGithubRequests } from "./github-request-concurrency";

it("bounds simultaneous requests without dropping installations or reordering results", async () => {
  let active = 0;
  let peak = 0;
  const result = await mapGithubRequests(
    [1, 2, 3, 4, 5, 6, 7, 8],
    async (value) => {
      active++;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active--;
      return value * 2;
    }
  );
  expect(peak).toBe(3);
  expect(result).toEqual([2, 4, 6, 8, 10, 12, 14, 16]);
  expect(await mapGithubRequests([], async () => 1)).toEqual([]);
});

it("propagates a provider failure instead of reporting a complete inventory", async () => {
  await expect(
    mapGithubRequests([1], async () => {
      throw new Error("provider unavailable");
    })
  ).rejects.toThrow("provider unavailable");
});
