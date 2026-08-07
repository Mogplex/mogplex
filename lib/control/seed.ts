/**
 * Seed data for the Control surface.
 *
 * This file provides demo data mirroring the interactive mockup so
 * the Control surface renders rich content immediately. It stands in
 * until missions are DB-backed via lib/orchestrations.
 *
 * DO NOT import from lib/orchestrations here - this is intentionally
 * decoupled until the backend schema is stable.
 */

import type {
  Mission,
  Changeset,
  Deployment,
  Workspace,
  ControlSeedData,
  TimelineEvent,
} from "./types";
import { seedWorktrees } from "./seed-worktrees";

// Signal colors from mockup
const C = {
  orange: "#ff4b00",
  blue: "#5a6b86",
  amber: "#b7791f",
  red: "#c0574c",
  green: "#4f8a6a",
} as const;

function seedTimeline(): TimelineEvent[] {
  return [
    {
      kind: "user",
      label: "YOU",
      time: "12m ago",
      body: "Checkout p95 is 812ms against a 400ms target. Find the wins in the pricing path and try more than one approach.",
    },
    {
      kind: "plan",
      label: "PROPOSED PLAN",
      time: "12m ago",
      body: "Three independent bets, each in its own worktree, measured against the DEP-77 baseline.",
      steps: [
        {
          n: "01",
          text: "Read-through cache for pricing lookups",
          state: "RUNNING",
          color: C.blue,
        },
        {
          n: "02",
          text: "Batch N+1 resolver queries",
          state: "READY",
          color: C.amber,
        },
        {
          n: "03",
          text: "Tune the composite index on price_book",
          state: "FAILED",
          color: C.red,
        },
        {
          n: "04",
          text: "Edge cache for repeat quotes",
          state: "BLOCKED",
          color: C.red,
        },
      ],
      planApproved: true,
    },
    {
      kind: "delegate",
      label: "DELEGATED",
      time: "11m ago",
      body: "Four agent tasks dispatched. Worktrees forked from main at a91f2c.",
      chips: ["wt-a", "wt-b", "wt-c", "wt-d"],
    },
    {
      kind: "tool",
      label: "TOOL",
      time: "9m ago",
      body: "forge-2 ran `pnpm bench pricing --iterations 200` in sandbox container-med.",
    },
    {
      kind: "diff",
      label: "CHANGE SET CS-118",
      time: "6m ago",
      body: "forge-2 finished. 6 files, +214 / -63, 14 of 14 checks pass.",
      files: [
        { path: "src/pricing/resolver.ts", add: "+96", del: "-31" },
        { path: "src/pricing/loader.ts", add: "+74", del: "-18" },
        { path: "test/pricing.bench.ts", add: "+44", del: "-14" },
      ],
    },
    {
      kind: "fail",
      label: "RUN FAILED",
      time: "5m ago",
      body: "forge-3 crashed during migration tests.",
      log: "pg_container | FATAL: out of memory (limit 2048 MiB)\nrun    | exit 137 after 3m41s\nhint   | raise the sandbox memory profile or shard the migration test",
    },
    {
      kind: "conflict",
      label: "CONFLICT",
      time: "4m ago",
      body: "forge-4 cannot rebase onto main. src/pricing/resolver.ts diverged 7 commits behind.",
    },
    {
      kind: "compare",
      label: "COMPARISON",
      time: "3m ago",
      body: "forge-1 and forge-2 both reduce p95, with different risk.",
      columns: ["wt-a", "wt-b"],
    },
    {
      kind: "approval",
      label: "APPROVAL REQUESTED",
      time: "2m ago",
      body: "",
      approvalText:
        "forge-2 requests permission to promote CS-118 to the integration queue and merge into main. Policy requires human approval for merges in atlas-api.",
      resolved: "",
    },
  ];
}

function seedWorkspaces(): Workspace[] {
  return [
    {
      id: "ws-atlas",
      name: "Pricing API",
      project: "prj-checkout",
      provider: "GitHub",
      repo: "mogplex/atlas-api",
      branch: "main",
      status: "active",
    },
    {
      id: "ws-console",
      name: "Console web",
      project: "prj-platform",
      provider: "GitHub",
      repo: "mogplex/console-web",
      branch: "main",
      status: "active",
    },
    {
      id: "ws-ledger",
      name: "Ledger service",
      project: "prj-platform",
      provider: "GitLab",
      repo: "mogplex/ledger-svc",
      branch: "trunk",
      status: "active",
    },
  ];
}

function seedChangesets(): Changeset[] {
  return [
    {
      id: "CS-118",
      mission: "MSN-241",
      worktree: "wt-b",
      ws: "ws-atlas",
      title: "Batch N+1 pricing queries",
      commits: 3,
      range: "a91f2c...e77b41",
      files: 6,
      add: 214,
      del: 63,
      review: "1 of 2 approvals",
      checks: "14/14 pass",
      conflicts: 0,
      risk: "medium",
      target: "main",
      env: "staging",
      state: "queued",
    },
    {
      id: "CS-117",
      mission: "MSN-241",
      worktree: "wt-a",
      ws: "ws-atlas",
      title: "Read-through cache for pricing lookups",
      commits: 4,
      range: "a91f2c...c02d18",
      files: 9,
      add: 388,
      del: 97,
      review: "not requested",
      checks: "12/14 running",
      conflicts: 2,
      risk: "medium",
      target: "main",
      env: "-",
      state: "draft",
    },
    {
      id: "CS-114",
      mission: "MSN-238",
      worktree: "wt-e",
      ws: "ws-atlas",
      title: "Telemetry baseline for pricing path",
      commits: 2,
      range: "7db3aa...a91f2c",
      files: 5,
      add: 96,
      del: 12,
      review: "approved",
      checks: "14/14 pass",
      conflicts: 0,
      risk: "low",
      target: "main",
      env: "staging",
      state: "merged",
    },
  ];
}

function seedDeployments(): Deployment[] {
  return [
    {
      id: "DEP-77",
      ws: "ws-atlas",
      env: "staging",
      changeset: "CS-114",
      commit: "a91f2c",
      age: "26m",
      health: "degraded",
      note: "60% rollout, p95 improving",
      mission: "MSN-238",
    },
    {
      id: "DEP-76",
      ws: "ws-atlas",
      env: "preview",
      changeset: "CS-118",
      commit: "e77b41",
      age: "4m",
      health: "healthy",
      note: "preview-7f3",
      mission: "MSN-241",
    },
    {
      id: "DEP-74",
      ws: "ws-ledger",
      env: "production",
      changeset: "CS-109",
      commit: "b41c7d",
      age: "2d 4h",
      health: "healthy",
      note: "v2026.7.3",
      mission: "MSN-232",
    },
  ];
}

function seedMissions(): Mission[] {
  return [
    {
      id: "MSN-241",
      title: "Cut checkout p95 latency below 400ms",
      ws: "ws-atlas",
      status: "attention",
      pinned: true,
      age: "4m",
      cost: 14.82,
      budget: 60,
      base: "main",
      env: "staging",
      autonomy: "Supervised",
      approval: "Human merge + deploy",
      sandbox: "container-med",
      archived: false,
      timeline: seedTimeline(),
    },
    {
      id: "MSN-238",
      title: "Instrument pricing path with p95 telemetry",
      ws: "ws-atlas",
      status: "completed",
      pinned: false,
      age: "2h",
      cost: 9.4,
      budget: 40,
      base: "main",
      env: "staging",
      autonomy: "Supervised",
      approval: "Human merge",
      sandbox: "container-sm",
      archived: false,
      timeline: [
        {
          kind: "user",
          label: "YOU",
          time: "2h ago",
          body: "Add p95 telemetry to the pricing path so we can measure the latency work.",
        },
        {
          kind: "done",
          label: "OUTCOME",
          time: "1h 48m ago",
          body: "CS-114 merged into main and deployed to staging as DEP-77. Baseline p95 recorded at 812ms.",
        },
      ],
    },
    {
      id: "MSN-232",
      title: "Make settlement retries idempotent",
      ws: "ws-ledger",
      status: "completed",
      pinned: false,
      age: "2d",
      cost: 63.1,
      budget: 120,
      base: "trunk",
      env: "production",
      autonomy: "Autonomous",
      approval: "Two approvers",
      sandbox: "firecracker-lg",
      archived: false,
      timeline: [
        {
          kind: "user",
          label: "YOU",
          time: "2d ago",
          body: "Settlement retries are double-charging on partial failures. Make them idempotent.",
        },
        {
          kind: "deploy",
          label: "DEPLOYMENT",
          time: "2d ago",
          body: "CS-109 deployed to production as DEP-74 (v2026.7.3). No error-rate regression after 48h.",
        },
      ],
    },
    {
      id: "MSN-229",
      title: "Keyboard navigation for the run table",
      ws: "ws-console",
      status: "attention",
      pinned: false,
      age: "3d",
      cost: 5.2,
      budget: 30,
      base: "main",
      env: "-",
      autonomy: "Supervised",
      approval: "Human merge",
      sandbox: "container-sm",
      archived: false,
      timeline: [
        {
          kind: "user",
          label: "YOU",
          time: "3d ago",
          body: "The run table needs full keyboard navigation, including range selection.",
        },
        {
          kind: "fail",
          label: "CHANGES REQUESTED",
          time: "2d ago",
          body: "Reviewer asked for roving tabindex instead of manual focus management. CS-104 is blocked on rework.",
          log: "review | changes requested by M. Osei\nreview | use roving tabindex pattern instead of manual focus\nstatus | blocked on rework",
        },
      ],
    },
    {
      id: "MSN-221",
      title: "Retire the legacy runs API",
      ws: "ws-console",
      status: "archived",
      pinned: false,
      age: "11d",
      cost: 22.7,
      budget: 80,
      base: "main",
      env: "production",
      autonomy: "Supervised",
      approval: "Human merge",
      sandbox: "container-sm",
      archived: true,
      timeline: [
        {
          kind: "done",
          label: "OUTCOME",
          time: "11d ago",
          body: "Legacy endpoints removed, DEP-71 shipped, mission archived.",
        },
      ],
    },
  ];
}

export function getControlSeedData(): ControlSeedData {
  return {
    missions: seedMissions(),
    worktrees: seedWorktrees(),
    changesets: seedChangesets(),
    deployments: seedDeployments(),
    workspaces: seedWorkspaces(),
  };
}

// Helper to generate next mission ID
let nextMissionNum = 242;
export function generateMissionId(): string {
  return `MSN-${nextMissionNum++}`;
}

// Helper to format cost as money
export function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
}
