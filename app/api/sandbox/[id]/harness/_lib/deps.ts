import { supabaseAdmin } from "@/lib/supabase/admin";
import { getSandboxServiceCredentials } from "@/lib/sandbox/get-user-credentials";
import { getSandbox } from "@/lib/sandbox/client";
import { runHarness } from "@/lib/harness/runner";
import { getGithubAccessTokenForRepo } from "@/lib/github-access";
import { resolveSandboxGitAuthor } from "@/lib/sandbox/git-author";
import {
  ensureDevTools,
  syncTerminalRuntimeAuth,
} from "@/lib/sandbox/dev-tools";
import { getResolvedConnections } from "@/lib/connections/service";
import { injectClaudeMcpConfig } from "@/lib/harness/mcp-config";
import { renewSandboxActivityLease } from "@/lib/sandbox/activity-lease";
import {
  stopSandboxRecord,
  touchSandboxLastActive,
} from "@/lib/sandbox/records";
import { resolveRepoSandboxEnv } from "@/lib/vercel/env-vars";
import {
  createAiCall,
  loadOwnedAiCall,
  mergeAiCallMetadata,
  updateAiCall,
  finalizeAiCallAsCancelledIfActive,
  finalizeAiCallIfNotCancelled,
  safeAppendAiCallEvent,
} from "@/lib/interactive-runs";
import { resolveSandboxAiAccess } from "@/lib/sandbox/ai-runtime";
import { getSlackBotToken } from "@/lib/slack/client";
import {
  syncHarnessGitWorkspace,
  publishHarnessPullRequest,
} from "@/lib/harness/git-delivery";
import {
  loadHarnessPromptWithMemoryContext,
  persistHarnessMemory,
} from "./memory";
import type { HarnessSandboxRecord, SandboxHarnessPostDeps } from "./types";
import { HARNESS_ROUTE_SELECT } from "./types";

export const defaultSandboxHarnessPostDeps: SandboxHarnessPostDeps = {
  getSandboxServiceCredentials,
  async loadOwnedSandboxRecord(sandboxId, userId) {
    const { data } = await supabaseAdmin
      .from("sandboxes")
      .select(HARNESS_ROUTE_SELECT)
      .eq("id", sandboxId)
      .eq("user_id", userId)
      .single();

    return (data as HarnessSandboxRecord | null) ?? null;
  },
  async loadOwnedWorktreeBinding(input) {
    let query = supabaseAdmin
      .from("orchestration_worktrees")
      .select(
        "id, sandbox_id, repo_id, branch_name, base_branch, checkout_path, status"
      )
      .eq("id", input.worktreeId)
      .eq("user_id", input.userId)
      .eq("sandbox_id", input.sandboxId)
      .eq("status", "active");
    if (input.repoId) query = query.eq("repo_id", input.repoId);
    const { data, error } = await query.maybeSingle();
    if (error) throw new Error(`Failed to load worktree: ${error.message}`);
    return data;
  },
  resolveSandboxAiAccess,
  getSandbox,
  runHarness,
  getGithubAccessTokenForRepo,
  resolveSandboxGitAuthor,
  ensureDevTools,
  getResolvedConnections,
  injectClaudeMcpConfig,
  renewSandboxActivityLease,
  stopSandboxRecord,
  touchSandboxLastActive,
  resolveRepoSandboxEnv,
  createAiCall,
  loadOwnedAiCall,
  mergeAiCallMetadata,
  updateAiCall,
  finalizeAiCallAsCancelledIfActive,
  finalizeAiCallIfNotCancelled,
  safeAppendAiCallEvent,
  loadHarnessPromptWithMemoryContext,
  persistHarnessMemory,
  syncTerminalRuntimeAuth,
  syncHarnessGitWorkspace,
  publishHarnessPullRequest,
  async updateSandboxWorkingBranch(input) {
    const { error } = await supabaseAdmin
      .from("sandboxes")
      .update({ working_branch: input.workingBranch })
      .eq("id", input.recordId)
      .eq("user_id", input.userId)
      .eq("sandbox_id", input.sandboxId);
    if (error) {
      throw new Error(`Failed to persist agent branch: ${error.message}`);
    }
  },
  getSlackBotToken,
  fetchSlackAttachment: ({ botToken, url, signal }) =>
    fetch(url, {
      headers: { Authorization: `Bearer ${botToken}` },
      redirect: "error",
      signal,
    }),
};
