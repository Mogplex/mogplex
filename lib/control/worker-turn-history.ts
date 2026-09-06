import type { ControlWorker } from "./workers";

export type WorkerTurnHistory = {
  turnId: string;
  historicalIds: ReadonlySet<string>;
};

function isActive(worker: ControlWorker): boolean {
  return ["pending", "streaming", "awaiting_input"].includes(worker.status);
}

/** Hide only workers known to be finished when this request began. */
export function updateWorkerTurnHistory(
  previous: WorkerTurnHistory | undefined,
  turnId: string,
  workers: ControlWorker[]
): WorkerTurnHistory {
  if (previous?.turnId !== turnId) {
    return {
      turnId,
      historicalIds: new Set(
        workers.filter((worker) => !isActive(worker)).map((worker) => worker.id)
      ),
    };
  }
  // A resumed worker becomes part of this turn, including its final output.
  const resumed = workers.filter(
    (worker) => isActive(worker) && previous.historicalIds.has(worker.id)
  );
  if (resumed.length === 0) return previous;
  const historicalIds = new Set(previous.historicalIds);
  for (const worker of resumed) historicalIds.delete(worker.id);
  return { turnId, historicalIds };
}

export function workersForTurn(
  workers: ControlWorker[],
  history: WorkerTurnHistory
): ControlWorker[] {
  return workers.filter((worker) => !history.historicalIds.has(worker.id));
}
