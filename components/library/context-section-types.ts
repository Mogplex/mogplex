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

export const LANES: MemoryLane[] = [
  "session",
  "semantic",
  "episodic",
  "procedural",
];

export const LANE_INFO: Record<MemoryLane, { label: string; desc: string }> = {
  session: { label: "Session", desc: "Working set for current task" },
  semantic: { label: "Semantic", desc: "Durable truths and preferences" },
  episodic: { label: "Episodic", desc: "Timeline events and milestones" },
  procedural: { label: "Procedural", desc: "Reusable workflows and runbooks" },
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
