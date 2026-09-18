export type { Repo } from "@/lib/types";

export type MemoryLane = "session" | "semantic" | "episodic" | "procedural";
export type MemoryResourceScope = "all" | "personal" | "team";

export type Memory = {
  id: string;
  lane: MemoryLane;
  content: string;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type MemoryGroups = Record<MemoryLane, Memory[]>;
export type MemoryCounts = Record<MemoryLane, number>;
export type MemoryPayload = { groups: MemoryGroups; counts: MemoryCounts };

export const LANES: MemoryLane[] = [
  "session",
  "semantic",
  "episodic",
  "procedural",
];

export const LANE_INFO: Record<MemoryLane, { label: string; desc: string }> = {
  session: {
    label: "Session",
    desc: "Per-conversation notes. Never injected into Control; pruned after 30 days.",
  },
  semantic: {
    label: "Facts",
    desc: "Stable facts and preferences. Injected into every Control turn.",
  },
  episodic: {
    label: "Events",
    desc: "Notable decisions and outcomes. The newest few reach Control.",
  },
  procedural: {
    label: "Procedures",
    desc: "How-to patterns you have accepted. Injected into every Control turn.",
  },
};

export const SCOPE_LABELS: Record<MemoryResourceScope, string> = {
  all: "All",
  personal: "Personal",
  team: "Team",
};

export interface ContextSectionProps {
  /** Compact mode for split-pane usage */
  compact?: boolean;
  repoId?: string | null;
  repoName?: string | null;
  workspaceSessionId?: string | null;
}
