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
