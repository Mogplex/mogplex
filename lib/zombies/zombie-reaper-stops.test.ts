import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  forEachConcurrently,
  stopWorkers,
  type WorkerStop,
} from "./zombie-reaper-stops";

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

describe("stopWorkers", () => {
  const fakeClient = {} as unknown as SupabaseClient;
  const makeStop = (id: string): WorkerStop => ({
    call: { id, user_id: "owner" },
    error: "Stopped after idle window",
  });

  it("should track stops that returned false as notFound", async () => {
    const calls: string[] = [];
    const stopWorker = async (input: { call: { id: string } }) => {
      calls.push(input.call.id);
      return input.call.id === "stop-1"; // stop-1 stopped, stop-2 did not
    };

    const result = await stopWorkers(
      fakeClient,
      [makeStop("stop-1"), makeStop("stop-2")],
      stopWorker
    );

    expect(calls.toSorted()).toEqual(["stop-1", "stop-2"]);
    expect(result.failures).toEqual([]);
    expect(result.notFound).toEqual(["stop-2"]);
  });

  it("should track stops that threw as failures", async () => {
    const stopWorker = async (input: { call: { id: string } }) => {
      if (input.call.id === "stop-2") throw new Error("Trigger unavailable");
      return true;
    };

    const result = await stopWorkers(
      fakeClient,
      [makeStop("stop-1"), makeStop("stop-2")],
      stopWorker
    );

    expect(result.failures).toEqual([
      { id: "stop-2", error: "Trigger unavailable" },
    ]);
    expect(result.notFound).toEqual([]);
  });

  it("should track both notFound and failures in the same batch", async () => {
    const stopWorker = async (input: { call: { id: string } }) => {
      if (input.call.id === "fail") throw new Error("Network error");
      return input.call.id === "ok";
    };

    const result = await stopWorkers(
      fakeClient,
      [makeStop("ok"), makeStop("noop"), makeStop("fail")],
      stopWorker
    );

    expect(result.notFound).toEqual(["noop"]);
    expect(result.failures).toEqual([{ id: "fail", error: "Network error" }]);
  });
});
