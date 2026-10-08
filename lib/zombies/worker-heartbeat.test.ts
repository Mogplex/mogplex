import { describe, expect, it, vi } from "vitest";
import {
  createWorkerHeartbeatTimer,
  WORKER_HEARTBEAT_INTERVAL_MS,
} from "@/lib/interactive-runs";

describe("createWorkerHeartbeatTimer", () => {
  it("should call the callback after the heartbeat interval", () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const stop = createWorkerHeartbeatTimer(callback);

    expect(callback).not.toHaveBeenCalled();

    vi.advanceTimersByTime(WORKER_HEARTBEAT_INTERVAL_MS - 1);
    expect(callback).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledTimes(1);

    stop();
    vi.useRealTimers();
  });

  it("should not call the callback if stopped before the interval", () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const stop = createWorkerHeartbeatTimer(callback);

    vi.advanceTimersByTime(WORKER_HEARTBEAT_INTERVAL_MS / 2);
    expect(callback).not.toHaveBeenCalled();

    stop();

    vi.advanceTimersByTime(WORKER_HEARTBEAT_INTERVAL_MS);
    expect(callback).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("should handle async callbacks gracefully", async () => {
    vi.useFakeTimers();
    const callback = vi.fn().mockResolvedValue(undefined);
    const stop = createWorkerHeartbeatTimer(callback);

    vi.advanceTimersByTime(WORKER_HEARTBEAT_INTERVAL_MS);
    expect(callback).toHaveBeenCalledTimes(1);

    stop();
    vi.useRealTimers();
  });

  it("should not throw if callback fails", () => {
    vi.useFakeTimers();
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const callback = vi.fn().mockRejectedValue(new Error("test error"));
    const stop = createWorkerHeartbeatTimer(callback);

    expect(() => {
      vi.advanceTimersByTime(WORKER_HEARTBEAT_INTERVAL_MS);
    }).not.toThrow();

    stop();
    consoleWarn.mockRestore();
    vi.useRealTimers();
  });

  it("should only fire once (not repeatedly)", () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const stop = createWorkerHeartbeatTimer(callback);

    vi.advanceTimersByTime(WORKER_HEARTBEAT_INTERVAL_MS);
    expect(callback).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(WORKER_HEARTBEAT_INTERVAL_MS);
    expect(callback).toHaveBeenCalledTimes(1); // Still 1, not 2

    stop();
    vi.useRealTimers();
  });
});
