import { expect, it } from "vitest";
import type { ControlWorker } from "./workers";
import { updateWorkerTurnHistory, workersForTurn } from "./worker-turn-history";

function worker(id: string, status: ControlWorker["status"]): ControlWorker {
  return {
    id,
    status,
    worktreeId: id,
    branch: id,
    error: null,
    updatedAt: "2026-08-01",
    events: [],
  };
}

it.each(["success", "failed", "cancelled"] as const)(
  "keeps current workers after %s while excluding already finished workers",
  (status) => {
    const old = worker("old", "failed");
    const active = worker("active", "streaming");
    const history = updateWorkerTurnHistory(undefined, "turn-1", [old, active]);
    const finished = [old, worker("active", status), worker("new", status)];
    const updated = updateWorkerTurnHistory(history, "turn-1", finished);
    expect(workersForTurn(finished, updated).map((entry) => entry.id)).toEqual([
      "active",
      "new",
    ]);
    expect(updated).toBe(history);
  }
);

it("keeps resumed workers through completion and resets history for a new request", () => {
  const old = worker("resumed", "failed");
  const history = updateWorkerTurnHistory(undefined, "turn-1", [old]);
  const resumed = updateWorkerTurnHistory(history, "turn-1", [
    worker("resumed", "pending"),
  ]);
  expect(workersForTurn([old], resumed)).toEqual([old]);
  expect(
    workersForTurn([old], updateWorkerTurnHistory(resumed, "turn-2", [old]))
  ).toEqual([]);
  expect(workersForTurn([old], history)).toEqual([]);
});

it("retains workers when their initial state was unknown", () => {
  const history = updateWorkerTurnHistory(undefined, "turn", []);
  const firstSnapshot = [worker("fast", "success")];
  expect(
    workersForTurn(
      firstSnapshot,
      updateWorkerTurnHistory(history, "turn", firstSnapshot)
    )
  ).toEqual(firstSnapshot);
});
