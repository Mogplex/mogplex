import type { Sandbox, NetworkPolicy } from "@vercel/sandbox";
import type { SandboxHealthStatus } from "@/lib/sandbox/health-status";
import type {
  SandboxRuntime,
  getStrategy,
  detectRuntime,
} from "@/lib/sandbox/runtimes";
import type {
  EnvSyncMode,
  RepoEnvVars,
  buildRuntimeSandboxEnv,
} from "@/lib/repo-settings";
import type { LinkedVercelProject } from "@/lib/vercel/env-vars";

export type CreateSandboxOpts = {
  vercelToken: string;
  vercelTeamId?: string | null;
  vercelProjectId: string;
  githubToken: string;
  repoFullName: string;
  branch?: string;
  runtime?: SandboxRuntime | null;
  devPort?: number | null;
  timeoutMs?: number | null;
  envVars?: RepoEnvVars | null;
  networkPolicy?: NetworkPolicy;
  /**
   * Stable sandbox name. When omitted, Vercel auto-generates one. Our
   * launch flow passes `mogplex-{repoShort}-{branch}-{recordShort}` so
   * operators can locate a user's sandbox in the Vercel dashboard.
   */
  name?: string;
  /**
   * Create a persistent sandbox (v2 beta). Defaults to true — auto-
   * snapshots filesystem state when the session stops so a later
   * Sandbox.get({ name, resume: true }) restarts from the last state.
   */
  persistent?: boolean;
  /**
   * Default snapshot expiration in ms for auto-snapshots. Defaults to
   * 7 days. Use 0 for no expiration.
   */
  snapshotExpirationMs?: number;
  onResume?: (sandbox: Sandbox) => Promise<void>;
};

export type CreateFromSnapshotOpts = {
  vercelToken: string;
  vercelTeamId?: string | null;
  vercelProjectId: string;
  snapshotId: string;
  runtime?: SandboxRuntime | null;
  devPort?: number | null;
  timeoutMs?: number | null;
  envVars?: RepoEnvVars | null;
  networkPolicy?: NetworkPolicy;
  name?: string;
  persistent?: boolean;
  snapshotExpirationMs?: number;
  onResume?: (sandbox: Sandbox) => Promise<void>;
};

export type BootstrapSandboxOpts = {
  rootDirectory?: string | null;
  installCommand?: string | null;
  devCommand?: string | null;
  devPort?: number | null;
  envVars?: RepoEnvVars | null;
  envSyncMode?: EnvSyncMode | null;
  linkedVercelProject?: LinkedVercelProject | null;
  runtime?: SandboxRuntime | null;
};

export type BootstrapDetection = Awaited<ReturnType<typeof detectRuntime>>;
export type BootstrapStrategy = ReturnType<typeof getStrategy>;

export type PreviewReadyResult = {
  ready: true;
  healthStatus: SandboxHealthStatus;
  statusCode: number | null;
  previewError: string | null;
  devLog: string;
};

export type SandboxBootstrapLogPhase =
  | "install"
  | "workspace"
  | "rebuild"
  | "dev";

export type ResolvedBootstrapContext = {
  normalizedRoot: string | null;
  effectiveRuntime: SandboxRuntime;
  strategy: BootstrapStrategy;
  effectiveDetection: BootstrapDetection;
  packageManager: BootstrapDetection["packageManager"];
  framework: BootstrapDetection["framework"];
  frameworkEntry: BootstrapDetection["frameworkEntry"];
  packageDevScript: string | null;
  hasDevScript: boolean;
  readiness: PreviewReadinessOptions;
  previewUrl: string;
  runtimeEnv: ReturnType<typeof buildRuntimeSandboxEnv>;
  devLogPath: string;
  installCommand: string;
  devCommand: string;
  /**
   * Command that compiles workspace:* dependencies of the target package so
   * their `dist/` outputs exist before dev starts. Null when the project
   * has no workspace deps, or the package manager doesn't support filtered
   * workspace builds (npm, bun).
   */
  workspaceBuildCommand: string | null;
  installDir: string | null;
  vercelLinkWarning: string | null;
  /** Populated when we auto-selected a workspace member as the preview
   * target (e.g. redirected to `web/` for a monorepo whose root isn't a web
   * app). Surfaces as a warning so the user sees where dev actually runs. */
  monorepoAutoTargetMessage: string | null;
};

export type BaselineSnapshotBootstrapOpts = BootstrapSandboxOpts & {
  baseBranch: string;
  workingBranch: string;
  createBranch: boolean;
  expectedLockfileHash: string;
};

export type PreviewReadinessOptions = {
  treatRoot404AsReady?: boolean;
};

export type SandboxStreamingCommand = {
  logs: () => AsyncIterable<{ data: string }>;
  wait: () => Promise<{ exitCode: number | null }>;
};

export type PreviewSignalRaceWinner =
  | {
      kind: "log";
      entry: Awaited<ReturnType<AsyncIterator<{ data: string }>["next"]>>;
    }
  | { kind: "exit"; result: { exitCode: number | null } }
  | { kind: "timeout" };

// Re-export types used by other modules
export type { SandboxBootstrapStreamEvent } from "@/lib/sandbox/events";
export type { NetworkPolicy } from "@vercel/sandbox";
export type { SandboxRuntime } from "@/lib/sandbox/runtimes";
export type { RepoEnvVars, EnvSyncMode } from "@/lib/repo-settings";
export type { LinkedVercelProject } from "@/lib/vercel/env-vars";
export type { SandboxHealthStatus } from "@/lib/sandbox/health-status";
