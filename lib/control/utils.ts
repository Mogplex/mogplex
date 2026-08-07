import type { ControlSeedData } from "./types";

// Mission ids are client-generated until missions are DB-backed via
// lib/orchestrations.
let nextMissionNum = 1;
export function generateMissionId(): string {
  return `MSN-${nextMissionNum++}`;
}

export function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

export function emptyControlData(): ControlSeedData {
  return {
    missions: [],
    worktrees: [],
    changesets: [],
    deployments: [],
    workspaces: [],
  };
}
