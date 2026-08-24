import type { getGithubAccessTokenForRepo } from "@/lib/github-access";
import type { getSandboxServiceCredentials } from "@/lib/sandbox/get-user-credentials";
import type { getSandbox, listVercelSandboxes } from "@/lib/sandbox/client";
import type { renewSandboxActivityLease } from "@/lib/sandbox/activity-lease";
import type { touchSandboxLastActive } from "@/lib/sandbox/records";
import type {
  acquireSandboxExecLock,
  enforceSandboxExecLimits,
  recordLimitDecision,
  releaseSandboxExecLock,
} from "@/lib/request-limits";
import type { resolveSandboxAiAccess } from "@/lib/sandbox/ai-runtime";
import type { syncTerminalRuntimeAuth } from "@/lib/sandbox/dev-tools";

export type ExecSandboxRecord = {
  sandbox_id: string;
  billing_source?: string | null;
  billing_team_id?: string | null;
  billing_project_id?: string | null;
  vercel_team_id: string | null;
  vercel_project_id: string | null;
  preview_url: string | null;
  repo:
    | {
        root_directory?: string | null;
        sandbox_env_vars?: unknown;
        env_sync_mode?: unknown;
        vercel_project_id?: string | null;
        vercel_team_id?: string | null;
        github_installation_id?: number | null;
      }
    | Array<{
        root_directory?: string | null;
        sandbox_env_vars?: unknown;
        env_sync_mode?: unknown;
        vercel_project_id?: string | null;
        vercel_team_id?: string | null;
        github_installation_id?: number | null;
      }>
    | null;
};

export type SandboxExecPostDeps = {
  getSandboxServiceCredentials: typeof getSandboxServiceCredentials;
  loadOwnedSandboxRecord: (
    sandboxId: string,
    userId: string
  ) => Promise<ExecSandboxRecord | null>;
  enforceSandboxExecLimits: typeof enforceSandboxExecLimits;
  acquireSandboxExecLock: typeof acquireSandboxExecLock;
  recordLimitDecision: typeof recordLimitDecision;
  releaseSandboxExecLock: typeof releaseSandboxExecLock;
  getSandbox: typeof getSandbox;
  listVercelSandboxes: typeof listVercelSandboxes;
  resolveSandboxAiAccess: typeof resolveSandboxAiAccess;
  getGithubAccessTokenForRepo: typeof getGithubAccessTokenForRepo;
  syncTerminalRuntimeAuth: typeof syncTerminalRuntimeAuth;
  touchSandboxLastActive: typeof touchSandboxLastActive;
  renewSandboxActivityLease: typeof renewSandboxActivityLease;
};
