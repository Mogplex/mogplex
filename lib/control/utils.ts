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

/**
 * Window event the status bar dispatches to switch the control route to the
 * sandboxes panel ("Sandboxes" segment).
 */
export const CONTROL_VIEW_EVENT = "mogplex:control-view";

export function emptyControlData(): ControlSeedData {
  return {
    missions: [],
    worktrees: [],
    changesets: [],
    deployments: [],
    workspaces: [],
  };
}
