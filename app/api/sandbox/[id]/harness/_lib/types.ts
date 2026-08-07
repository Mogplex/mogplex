import type { getSandboxServiceCredentials } from "@/lib/sandbox/get-user-credentials";
import type { getSandbox } from "@/lib/sandbox/client";
import type { runHarness } from "@/lib/harness/runner";
import type { getGithubAccessTokenForRepo } from "@/lib/github-access";
import type { resolveSandboxGitAuthor } from "@/lib/sandbox/git-author";
import type {
  ensureDevTools,
  syncTerminalRuntimeAuth,
} from "@/lib/sandbox/dev-tools";
import type { getResolvedConnections } from "@/lib/connections/service";
import type { injectClaudeMcpConfig } from "@/lib/harness/mcp-config";
import type { renewSandboxActivityLease } from "@/lib/sandbox/activity-lease";
import type {
  stopSandboxRecord,
  touchSandboxLastActive,
} from "@/lib/sandbox/records";
import type { resolveRepoSandboxEnv } from "@/lib/vercel/env-vars";
import type {
  createAiCall,
  loadOwnedAiCall,
  mergeAiCallMetadata,
  updateAiCall,
  finalizeAiCallAsCancelledIfActive,
  finalizeAiCallIfNotCancelled,
  safeAppendAiCallEvent,
} from "@/lib/interactive-runs";
import type { resolveSandboxAiAccess } from "@/lib/sandbox/ai-runtime";
import type { HarnessId } from "@/lib/harness/config";
import type { getSlackBotToken } from "@/lib/slack/client";
import type {
  loadHarnessPromptWithMemoryContext,
  persistHarnessMemory,
} from "./memory";
import type {
  syncHarnessGitWorkspace,
  publishHarnessPullRequest,
} from "@/lib/harness/git-delivery";

export const VALID_HARNESSES = new Set<HarnessId>(["claude-code", "codex"]);
export const MAX_LOG_EVENT_LENGTH = 4000;
export const HARNESS_ROUTE_SELECT =
  "repo_id, product_team_id, sandbox_id, root_directory, base_branch, working_branch, billing_source, billing_team_id, billing_project_id, vercel_team_id, vercel_project_id, preview_url, repo:repos(full_name, root_directory, sandbox_env_vars, env_sync_mode, vercel_project_id, vercel_team_id, github_installation_id)";

export type HarnessRepoRecord = {
  full_name: string | null;
  root_directory: string | null;
  sandbox_env_vars: unknown;
  env_sync_mode: string | null;
  vercel_project_id?: string | null;
  vercel_team_id?: string | null;
  github_installation_id?: number | null;
};

export type HarnessSandboxRecord = {
  repo_id: string | null;
  product_team_id?: string | null;
  sandbox_id: string;
  base_branch: string;
  working_branch: string;
  billing_source?: string | null;
  billing_team_id?: string | null;
  billing_project_id?: string | null;
  vercel_team_id: string | null;
  vercel_project_id: string | null;
  preview_url: string | null;
  repo: HarnessRepoRecord | HarnessRepoRecord[] | null;
};

export type SandboxHarnessPostDeps = {
  getSandboxServiceCredentials: typeof getSandboxServiceCredentials;
  loadOwnedSandboxRecord: (
    sandboxId: string,
    userId: string
  ) => Promise<HarnessSandboxRecord | null>;
  resolveSandboxAiAccess: typeof resolveSandboxAiAccess;
  getSandbox: typeof getSandbox;
  runHarness: typeof runHarness;
  getGithubAccessTokenForRepo: typeof getGithubAccessTokenForRepo;
  resolveSandboxGitAuthor: typeof resolveSandboxGitAuthor;
  ensureDevTools: typeof ensureDevTools;
  getResolvedConnections: typeof getResolvedConnections;
  injectClaudeMcpConfig: typeof injectClaudeMcpConfig;
  renewSandboxActivityLease: typeof renewSandboxActivityLease;
  stopSandboxRecord: typeof stopSandboxRecord;
  touchSandboxLastActive: typeof touchSandboxLastActive;
  resolveRepoSandboxEnv: typeof resolveRepoSandboxEnv;
  createAiCall: typeof createAiCall;
  loadOwnedAiCall: typeof loadOwnedAiCall;
  mergeAiCallMetadata: typeof mergeAiCallMetadata;
  updateAiCall: typeof updateAiCall;
  finalizeAiCallAsCancelledIfActive: typeof finalizeAiCallAsCancelledIfActive;
  finalizeAiCallIfNotCancelled: typeof finalizeAiCallIfNotCancelled;
  safeAppendAiCallEvent: typeof safeAppendAiCallEvent;
  loadHarnessPromptWithMemoryContext: typeof loadHarnessPromptWithMemoryContext;
  persistHarnessMemory: typeof persistHarnessMemory;
  syncTerminalRuntimeAuth: typeof syncTerminalRuntimeAuth;
  syncHarnessGitWorkspace: typeof syncHarnessGitWorkspace;
  publishHarnessPullRequest: typeof publishHarnessPullRequest;
  updateSandboxWorkingBranch: (input: {
    recordId: string;
    userId: string;
    sandboxId: string;
    workingBranch: string;
  }) => Promise<void>;
  getSlackBotToken: typeof getSlackBotToken;
  fetchSlackAttachment: (input: {
    botToken: string;
    url: string;
    signal: AbortSignal;
  }) => Promise<Response>;
};
