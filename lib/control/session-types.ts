import type { UIMessage } from "ai";

export type ControlSessionSummary = {
  id: string;
  title: string;
  /** Project the session belongs to; null groups under "General". */
  project: string | null;
  /** Exact connected repository used for agent and sandbox context. */
  repo_id: string | null;
  /** Model selected for this conversation and its follow-up turns. */
  model_id: string | null;
  /** Server-owned orchestration run backing the mission and worktrees. */
  orchestration_run_id: string | null;
  pinned: boolean;
  updated_at: string;
};

export type ControlSessionRecord = ControlSessionSummary & {
  messages: UIMessage[];
};
