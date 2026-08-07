/**
 * Control surface domain types.
 *
 * These mirror the mockup's data model and will eventually be replaced
 * by types from lib/orchestrations once missions are DB-backed.
 */

export type MissionStatus = "active" | "attention" | "completed" | "archived";

export type MissionPermissions = "Skip Permissions" | "Approve Edits";

// Order matters: index 0 is the composer default.
export const MISSION_PERMISSION_OPTIONS: MissionPermissions[] = [
  "Skip Permissions",
  "Approve Edits",
];

export type Mission = {
  id: string; // MSN-nnn
  title: string;
  ws: string; // workspace id
  status: MissionStatus;
  pinned: boolean;
  age: string;
  cost: number;
  base: string; // base branch
  env: string;
  permissions: MissionPermissions;
  approval: string;
  sandbox: string;
  archived: boolean;
  timeline: TimelineEvent[];
  targets?: string[]; // workspace ids when multi-workspace
};

export type WorktreeState =
  | "implementing"
  | "approval"
  | "failed"
  | "blocked"
  | "paused"
  | "archived";

export type Worktree = {
  id: string; // wt-x
  mission: string;
  ws: string;
  repo: string;
  agent: string;
  harness: string;
  branch: string;
  task: string;
  action: string;
  state: WorktreeState;
  elapsed: string;
  files: number;
  ahead: number;
  behind: number;
  checks: string;
  cost: number;
  ctx: number; // context %
  sandbox: string;
  risk: "low" | "medium" | "high" | "none";
  preview: string;
  warn: string;
};

export type ChangesetState =
  | "draft"
  | "queued"
  | "approved"
  | "merged"
  | "deployed"
  | "blocked";

export type Changeset = {
  id: string; // CS-nnn
  mission: string;
  worktree: string;
  ws: string;
  title: string;
  commits: number;
  range: string;
  files: number;
  add: number;
  del: number;
  review: string;
  checks: string;
  conflicts: number;
  risk: "low" | "medium" | "high";
  target: string;
  env: string;
  state: ChangesetState;
};

export type DeploymentHealth = "healthy" | "degraded" | "failed";

export type Deployment = {
  id: string; // DEP-nn
  ws: string;
  env: string;
  changeset: string;
  commit: string;
  age: string;
  health: DeploymentHealth;
  note: string;
  mission: string;
};

// Timeline event kinds
export type TimelineEventKind =
  | "user"
  | "plan"
  | "delegate"
  | "tool"
  | "diff"
  | "fail"
  | "conflict"
  | "compare"
  | "approval"
  | "git"
  | "deploy"
  | "question"
  | "done";

export type PlanStep = {
  n: string;
  text: string;
  state: string;
  color: string;
};

export type DiffFile = {
  path: string;
  add: string;
  del: string;
};

export type CompareColumn = {
  id: string;
  rows: Array<{ k: string; v: string }>;
};

// Base event shape
type BaseTimelineEvent = {
  kind: TimelineEventKind;
  label: string;
  time: string;
  body: string;
};

// Kind-specific payloads
export type UserEvent = BaseTimelineEvent & {
  kind: "user";
};

export type PlanEvent = BaseTimelineEvent & {
  kind: "plan";
  steps: PlanStep[];
  planApproved: boolean;
};

export type DelegateEvent = BaseTimelineEvent & {
  kind: "delegate";
  chips: string[];
};

export type ToolEvent = BaseTimelineEvent & {
  kind: "tool";
};

export type DiffEvent = BaseTimelineEvent & {
  kind: "diff";
  files: DiffFile[];
};

export type FailEvent = BaseTimelineEvent & {
  kind: "fail";
  log: string;
};

export type ConflictEvent = BaseTimelineEvent & {
  kind: "conflict";
};

export type CompareEvent = BaseTimelineEvent & {
  kind: "compare";
  columns: string[];
};

export type ApprovalEvent = BaseTimelineEvent & {
  kind: "approval";
  approvalText: string;
  resolved: string;
};

export type GitEvent = BaseTimelineEvent & {
  kind: "git";
};

export type DeployEvent = BaseTimelineEvent & {
  kind: "deploy";
};

export type QuestionEvent = BaseTimelineEvent & {
  kind: "question";
};

export type DoneEvent = BaseTimelineEvent & {
  kind: "done";
};

export type TimelineEvent =
  | UserEvent
  | PlanEvent
  | DelegateEvent
  | ToolEvent
  | DiffEvent
  | FailEvent
  | ConflictEvent
  | CompareEvent
  | ApprovalEvent
  | GitEvent
  | DeployEvent
  | QuestionEvent
  | DoneEvent;

// Workspace for context
export type Workspace = {
  id: string;
  name: string;
  project: string;
  provider: string;
  repo: string;
  branch: string;
  status: "active" | "paused";
};

// Full seed data shape
export type ControlSeedData = {
  missions: Mission[];
  worktrees: Worktree[];
  changesets: Changeset[];
  deployments: Deployment[];
  workspaces: Workspace[];
};
