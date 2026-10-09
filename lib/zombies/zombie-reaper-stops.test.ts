import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  forEachConcurrently,
  reportStopResults,
  stopWorkers,
  type ReportStopResultsDeps,
  type WorkerStop,
} from "./zombie-reaper-stops";
import type { ZombieReaperTableSummary } from "./zombie-reaper-types";

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

  it("should track stops that returned false as notStopped", async () => {
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
    expect(result.notStopped).toEqual(["stop-2"]);
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
    expect(result.notStopped).toEqual([]);
  });

  it("should track both notStopped and failures in the same batch", async () => {
    const stopWorker = async (input: { call: { id: string } }) => {
      if (input.call.id === "fail") throw new Error("Network error");
      return input.call.id === "ok";
    };

    const result = await stopWorkers(
      fakeClient,
      [makeStop("ok"), makeStop("noop"), makeStop("fail")],
      stopWorker
    );

    expect(result.notStopped).toEqual(["noop"]);
    expect(result.failures).toEqual([{ id: "fail", error: "Network error" }]);
  });
});

describe("reportStopResults", () => {
  const makeSummary = (): ZombieReaperTableSummary => ({
    table: "ai_calls",
    scanned: 0,
    reaped: 0,
    results: [],
    error: null,
  });

  it("records failures and not-stopped entries in the summary", () => {
    const deps: ReportStopResultsDeps = { captureWarning: () => {} };
    const summary = makeSummary();
    reportStopResults(
      summary,
      {
        failures: [{ id: "fail-1", error: "Trigger down" }],
        notStopped: ["noop-1", "noop-2"],
      },
      deps
    );

    expect(summary.results).toHaveLength(3);
    expect(summary.results[0]).toEqual({
      table: "ai_calls",
      id: "fail-1",
      ageMs: null,
      action: "worker_stop_failed",
      detail: "Trigger down",
    });
    expect(summary.results[1]).toEqual({
      table: "ai_calls",
      id: "noop-1",
      ageMs: null,
      action: "worker_not_stopped",
      detail: "No active worker to stop for idle call",
    });
    expect(summary.results[2]).toEqual({
      table: "ai_calls",
      id: "noop-2",
      ageMs: null,
      action: "worker_not_stopped",
      detail: "No active worker to stop for idle call",
    });
  });

  it("calls captureWarning only when failures exist", () => {
    const captured: Array<{ message: string; extra: Record<string, unknown> }> =
      [];
    const deps: ReportStopResultsDeps = {
      captureWarning: (message, extra) => captured.push({ message, extra }),
    };

    // No failures: captureWarning not called
    const summary1 = makeSummary();
    reportStopResults(summary1, { failures: [], notStopped: ["noop-1"] }, deps);
    expect(captured).toHaveLength(0);

    // With failures: captureWarning called
    const summary2 = makeSummary();
    reportStopResults(
      summary2,
      {
        failures: [{ id: "fail-1", error: "Trigger down" }],
        notStopped: [],
      },
      deps
    );
    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual({
      message: "[zombie-reaper] could not stop idle workers",
      extra: { failures: [{ id: "fail-1", error: "Trigger down" }] },
    });
  });
});
