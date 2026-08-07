import { MogplexMark } from "@/components/brand/mogplex-mark";
import { ClaudeFill, OpenaiFill } from "@/components/icons/harness-icons";

import { GearIcon } from "./icons";

/* ── live run mockup data ─────────────────────────────────────── */

export type TerminalLine = {
  t: string;
  lvl: "PASS" | "INFO" | "RUN";
  ev: string;
  plain: string;
  diff?: boolean;
  dyn?: boolean;
};

export const TERMINAL_DATA: TerminalLine[] = [
  {
    t: "10:24:31",
    lvl: "PASS",
    ev: "agent.planner.completed",
    plain: "Planner agent completed in 1.2s",
  },
  {
    t: "10:24:32",
    lvl: "INFO",
    ev: "agent.implement.started",
    plain: "Implement agent started",
  },
  {
    t: "10:24:50",
    lvl: "PASS",
    ev: "agent.implement.completed",
    plain: "Implement agent: 3 files changed (+142 −18)",
    diff: true,
  },
  {
    t: "10:24:53",
    lvl: "PASS",
    ev: "review.security.passed",
    plain: "Review (security) checks passed",
  },
  {
    t: "10:24:55",
    lvl: "PASS",
    ev: "review.quality.passed",
    plain: "Review (code quality) checks passed",
  },
  {
    t: "10:24:57",
    lvl: "RUN",
    ev: "deploy.staging.started",
    plain: "Deploy agent: deploying to staging",
  },
  {
    t: "10:25:19",
    lvl: "RUN",
    ev: "deploy.staging.progress",
    plain: "Deployment in progress",
    dyn: true,
  },
];

export const railItems = [
  {
    label: "Pipelines",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <circle cx="6" cy="6" r="2.3" />
        <circle cx="6" cy="18" r="2.3" />
        <circle cx="18" cy="12" r="2.3" />
        <path d="M7.9 7.4 15.9 11M7.9 16.6 15.9 13" />
      </svg>
    ),
  },
  {
    label: "Workspaces",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
      >
        <rect x="3.5" y="3.5" width="7" height="7" rx="1.2" />
        <rect x="13.5" y="3.5" width="7" height="7" rx="1.2" />
        <rect x="3.5" y="13.5" width="7" height="7" rx="1.2" />
        <rect x="13.5" y="13.5" width="7" height="7" rx="1.2" />
      </svg>
    ),
  },
  {
    label: "Terminal",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m6 8 3.6 3.6L6 15.2M12 15.5h6" />
      </svg>
    ),
  },
  {
    label: "Artifacts",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
      >
        <rect x="3.5" y="5" width="17" height="14" rx="2" />
        <circle cx="8.6" cy="10" r="1.4" />
        <path d="m20.5 15.5-4.2-4.2L9 18.5" />
      </svg>
    ),
  },
  { label: "Settings", icon: <GearIcon /> },
] as const;

export const planSteps = [
  {
    icon: "planner",
    name: "PLANNER",
    desc: "Break down and sequence the work",
  },
  { icon: "implement", name: "IMPLEMENT", desc: "Write code and add tests" },
  {
    icon: "review",
    name: "REVIEW",
    desc: "Review the diff and request changes",
  },
  { icon: "deploy", name: "DEPLOY", desc: "Merge and deploy behind your gates" },
] as const;

export const changedFiles = [
  ["middleware/rate_limit.py", "+78", "−2"],
  ["tests/test_rate_limit.py", "+45", "−0"],
  ["app/api/routes.py", "+19", "−16"],
] as const;


/* ── section data ─────────────────────────────────────────────── */

export const proofItems = [
  {
    label: "Apache-2.0 source",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" />
        <path d="m9 9-3 3 3 3M15 9l3 3-3 3" />
      </svg>
    ),
  },
  {
    label: "Bring your own keys",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <circle cx="8" cy="15" r="4" />
        <path d="m11 12 8-8M15 4h4v4M5 18l-2 2" />
      </svg>
    ),
  },
  {
    label: "Per-run sandboxes",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M4 5h16M4 12h16M4 19h16" />
        <circle cx="8" cy="5" r="2" style={{ fill: "var(--card)" }} />
        <circle cx="15" cy="12" r="2" style={{ fill: "var(--card)" }} />
        <circle cx="10" cy="19" r="2" style={{ fill: "var(--card)" }} />
      </svg>
    ),
  },
  {
    label: "Itemized run costs",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M4 19V9M10 19V5M16 19v-7M22 19V3" />
      </svg>
    ),
  },
] as const;

export const traceRows = [
  {
    label: "planner",
    time: "1.2s",
    offset: "0%",
    width: "24%",
    tone: "is-ink",
  },
  {
    label: "implement",
    time: "18.0s",
    offset: "21%",
    width: "51%",
    tone: "is-accent",
  },
  {
    label: "security",
    time: "2.1s",
    offset: "71%",
    width: "11%",
    tone: "is-green",
  },
  {
    label: "quality",
    time: "2.8s",
    offset: "71%",
    width: "16%",
    tone: "is-green",
  },
  {
    label: "deploy",
    time: "22.0s",
    offset: "86%",
    width: "14%",
    tone: "is-blue",
  },
] as const;

export const harnesses = [
  {
    id: "mogplex",
    label: "Mogplex Native",
    status: "HARNESS READY",
    kicker: "HARNESS READY",
    name: "Mogplex Native",
    icon: MogplexMark,
    chipTone: "is-orange",
    description:
      "The house agent, built into the platform. No CLI to install and no keys to bring — a pipeline runs on hosted models the moment you wire it.",
    bullets: [
      "Zero setup — no CLI, no keys",
      "Hosted models on your balance",
      "Tuned for Mogplex pipelines",
    ],
    yaml: [
      ["harness", "mogplex", true],
      ["model", "claude-opus-5", false],
      ["credentials", "mogplex-hosted", false],
      ["sandbox", "per-run", false],
      ["telemetry", "full", false],
    ],
  },
  {
    id: "claude",
    label: "Claude Code",
    status: "HARNESS READY",
    kicker: "HARNESS READY",
    name: "Claude Code",
    icon: ClaudeFill,
    chipTone: "is-beige",
    description:
      "Keep the Claude Code workflow you know. Mogplex adds the sandbox, the gates, and the run telemetry.",
    bullets: [
      "Existing CLAUDE.md behavior preserved",
      "Keys stay in your vault",
      "Full run telemetry",
    ],
    yaml: [
      ["harness", "claude-code", true],
      ["model", "claude-opus-5", false],
      ["credentials", "vault://platform/anthropic", false],
      ["sandbox", "per-run", false],
      ["telemetry", "full", false],
    ],
  },
  {
    id: "codex",
    label: "Codex",
    status: "HARNESS READY",
    kicker: "HARNESS READY",
    name: "Codex",
    icon: OpenaiFill,
    chipTone: "is-white",
    description:
      "Run Codex against your repos while Mogplex records every tool call, diff, token, and approval.",
    bullets: [
      "OpenAI keys routed through your vault",
      "Repository allowlists",
      "Unified spend and audit reporting",
    ],
    yaml: [
      ["harness", "codex", true],
      ["model", "gpt-5.6-sol", false],
      ["credentials", "vault://platform/openai", false],
      ["sandbox", "per-run", false],
      ["telemetry", "full", false],
    ],
  },
] as const;
