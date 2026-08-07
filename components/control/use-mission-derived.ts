"use client";

import { useMemo } from "react";
import type { Mission, Worktree, Changeset } from "@/lib/control/types";

export type MissionFilter = "active" | "attention" | "done" | "archive";

export type NeedsAttentionItem = {
  kind: "APPROVE" | "FAILED" | "CONFLICT";
  worktree: Worktree;
  changeset?: Changeset;
};

export type AgentStats = {
  total: number;
  awaiting: number;
  failed: number;
  spent: number;
};

/**
 * Derives filtered missions, attention items, and agent stats from mission data.
 * Extracted from ControlShell to reduce component complexity.
 */
export function useMissionDerived(
  missions: Mission[],
  missionFilter: MissionFilter,
  missionQuery: string,
  missionWorktrees: Worktree[],
  changesets: Changeset[],
  missionCost: number | undefined
): {
  filteredMissions: Mission[];
  needsAttention: NeedsAttentionItem[];
  agentStats: AgentStats;
} {
  // Filter missions by status and search query
  const filteredMissions = useMemo(
    () =>
      missions.filter((m) => {
        if (
          missionFilter === "active" &&
          (m.archived || m.status === "completed")
        )
          return false;
        if (missionFilter === "attention" && m.status !== "attention")
          return false;
        if (missionFilter === "done" && m.status !== "completed") return false;
        if (missionFilter === "archive" && !m.archived) return false;
        if (missionFilter !== "archive" && m.archived) return false;
        if (missionQuery) {
          const q = missionQuery.toLowerCase();
          return (m.title + " " + m.id).toLowerCase().includes(q);
        }
        return true;
      }),
    [missions, missionFilter, missionQuery]
  );

  // Worktrees needing attention (approval, failed, blocked)
  const needsAttention = useMemo(() => {
    const items: NeedsAttentionItem[] = [];
    for (const w of missionWorktrees) {
      if (w.state === "approval") {
        const cs = changesets.find(
          (c) =>
            c.worktree === w.id && !["merged", "deployed"].includes(c.state)
        );
        items.push({ kind: "APPROVE", worktree: w, changeset: cs });
      }
      if (w.state === "failed") {
        items.push({ kind: "FAILED", worktree: w });
      }
      if (w.state === "blocked") {
        items.push({ kind: "CONFLICT", worktree: w });
      }
    }
    // Sort: APPROVE first, then CONFLICT, then FAILED
    items.sort((a, b) => {
      const order = { APPROVE: 0, CONFLICT: 1, FAILED: 2 };
      return order[a.kind] - order[b.kind];
    });
    return items;
  }, [missionWorktrees, changesets]);

  // Agent summary statistics
  const agentStats = useMemo(() => {
    const activeWts = missionWorktrees.filter((w) => w.state !== "archived");
    const awaiting = activeWts.filter((w) => w.state === "approval").length;
    const failed = activeWts.filter(
      (w) => w.state === "failed" || w.state === "blocked"
    ).length;
    return {
      total: activeWts.length,
      awaiting,
      failed,
      spent: missionCost || 0,
    };
  }, [missionWorktrees, missionCost]);

  return { filteredMissions, needsAttention, agentStats };
}
