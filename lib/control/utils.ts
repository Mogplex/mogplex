import type { ControlSeedData, Mission } from "./types";

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

/**
 * Mark a mission timeline approval as approved by the user, leaving every
 * other mission and event untouched.
 */
export function approveMissionEvent(
  missions: Mission[],
  missionId: string,
  eventIndex: number
): Mission[] {
  return missions.map((mission) => {
    if (mission.id !== missionId) return mission;
    return {
      ...mission,
      timeline: mission.timeline.map((event, index) =>
        index === eventIndex && event.kind === "approval"
          ? { ...event, resolved: "Approved by you - merge unblocked" }
          : event
      ),
    };
  });
}
