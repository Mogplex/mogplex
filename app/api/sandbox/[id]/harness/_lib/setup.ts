import { buildRuntimeSandboxEnv } from "@/lib/repo-settings";
import {
  appendSlackAttachmentPromptSection,
  materializeSlackImageAttachmentsForHarness,
  normalizeSlackRunImageAttachmentsMetadata,
} from "@/lib/slack/run-attachments";
import { buildHarnessDeliveryPrompt } from "@/lib/harness/git-delivery";
import type { HarnessId } from "@/lib/harness/config";
import type { MemoryScope } from "@/lib/memories-client";
import type { Sandbox } from "@vercel/sandbox";
import type { HarnessRepoRecord, SandboxHarnessPostDeps } from "./types";

export type SandboxSetupContext = {
  id: string;
  userId: string;
  harnessId: HarnessId;
  conversationId: string | null;
  repoId: string | null;
  rootDirectory: string | null;
  sandboxId: string;
  baseBranch: string;
  workingBranch: string;
  previewUrl: string | null;
  aiCallId: string;
};

export type SandboxEnvSetup = {
  runtimeEnv: Record<string, string>;
  githubToken: string | null;
};

/**
 * Resolves environment variables for the sandbox runtime, including
 * AI provider credentials and GitHub installation tokens.
 */
export async function setupSandboxEnv(
  deps: Pick<
    SandboxHarnessPostDeps,
    "resolveRepoSandboxEnv" | "getGithubAccessTokenForRepo"
  >,
  ctx: SandboxSetupContext,
  harnessAiEnv: { env: Record<string, string>; aiBillingSource: string },
  repoRecord: HarnessRepoRecord | null
): Promise<SandboxEnvSetup> {
  const envResolution = await deps.resolveRepoSandboxEnv({
    repo: repoRecord ?? {},
    userId: ctx.userId,
  });
  const runtimeEnv = buildRuntimeSandboxEnv(
    envResolution.envVars,
    envResolution.sync.mode,
    ctx.previewUrl
  );
  Object.assign(runtimeEnv, harnessAiEnv.env, {
    MOGPLEX_AI_BILLING_SOURCE: harnessAiEnv.aiBillingSource,
  });

  let githubToken: string | null = null;
  if (repoRecord?.github_installation_id) {
    try {
      githubToken = await deps.getGithubAccessTokenForRepo({
        user_id: ctx.userId,
        github_installation_id: repoRecord.github_installation_id,
      });
      if (githubToken) {
        runtimeEnv.GITHUB_TOKEN = githubToken;
        runtimeEnv.GH_TOKEN = githubToken;
      }
    } catch (err) {
      console.warn("[harness] failed to mint github installation token", {
        sandboxId: ctx.sandboxId,
        error: err instanceof Error ? err.message : err,
      });
    }
  }

  return { runtimeEnv, githubToken };
}

/**
 * Configures the sandbox for GitHub-based delivery: installs dev tools,
 * sets up git identity, and syncs auth credentials.
 */
export async function setupGitDeliveryAuth(
  deps: Pick<
    SandboxHarnessPostDeps,
    "resolveSandboxGitAuthor" | "ensureDevTools" | "syncTerminalRuntimeAuth"
  >,
  sandbox: Sandbox,
  ctx: SandboxSetupContext,
  githubToken: string
): Promise<void> {
  const gitAuthor = await deps.resolveSandboxGitAuthor(ctx.userId);
  const devToolsResult = await deps.ensureDevTools(sandbox, {
    agentName: gitAuthor.name,
    agentEmail: gitAuthor.email,
  });
  if (!devToolsResult.ok) {
    console.warn("[harness] ensureDevTools failed", {
      sandboxId: ctx.sandboxId,
      error: devToolsResult.error,
    });
  }
  const authSync = await deps.syncTerminalRuntimeAuth(sandbox, {
    githubToken,
  });
  if (!authSync.ok) {
    throw new Error(
      authSync.error || "Failed to configure GitHub delivery access"
    );
  }
}

export type GitWorkspaceSetupResult = {
  baseBranch: string;
  workingBranch: string;
  createdBranch: boolean;
};

/**
 * Syncs the git workspace and updates the sandbox record if a new
 * branch was created.
 */
export async function setupGitWorkspace(
  deps: Pick<
    SandboxHarnessPostDeps,
    | "syncHarnessGitWorkspace"
    | "updateSandboxWorkingBranch"
    | "safeAppendAiCallEvent"
  >,
  sandbox: Sandbox,
  ctx: SandboxSetupContext,
  runtimeEnv: Record<string, string>
): Promise<GitWorkspaceSetupResult> {
  const gitWorkspace = await deps.syncHarnessGitWorkspace(sandbox, {
    aiCallId: ctx.aiCallId,
    baseBranch: ctx.baseBranch,
    workingBranch: ctx.workingBranch,
    cwd: ctx.rootDirectory || undefined,
    env: runtimeEnv,
  });

  if (gitWorkspace.createdBranch) {
    await deps.updateSandboxWorkingBranch({
      recordId: ctx.id,
      userId: ctx.userId,
      sandboxId: ctx.sandboxId,
      workingBranch: gitWorkspace.workingBranch,
    });
  }

  await deps.safeAppendAiCallEvent({
    aiCallId: ctx.aiCallId,
    userId: ctx.userId,
    conversationId: ctx.conversationId,
    repoId: ctx.repoId,
    eventType: "log",
    message: `Synchronized ${gitWorkspace.workingBranch}`,
    payload: {
      stage: "git_sync",
      base_branch: gitWorkspace.baseBranch,
      working_branch: gitWorkspace.workingBranch,
      created_branch: gitWorkspace.createdBranch,
    },
  });

  return gitWorkspace;
}

/**
 * Injects MCP server configuration for Claude Code harness runs.
 */
export async function setupMcpConfig(
  deps: Pick<
    SandboxHarnessPostDeps,
    "injectClaudeMcpConfig" | "getResolvedConnections" | "safeAppendAiCallEvent"
  >,
  sandbox: Sandbox,
  ctx: SandboxSetupContext
): Promise<string | undefined> {
  if (ctx.harnessId !== "claude-code") {
    return undefined;
  }

  if (!ctx.repoId) {
    console.warn(
      "[harness] skipping MCP injection: claude-code sandbox has no repo_id",
      { sandboxId: ctx.sandboxId }
    );
    return undefined;
  }

  const injection = await deps.injectClaudeMcpConfig(sandbox, {
    userId: ctx.userId,
    repoId: ctx.repoId,
    rootDirectory: ctx.rootDirectory,
    resolveConnections: deps.getResolvedConnections,
  });

  if (injection.ok) {
    if (injection.serverCount > 0) {
      await deps.safeAppendAiCallEvent({
        aiCallId: ctx.aiCallId,
        userId: ctx.userId,
        conversationId: ctx.conversationId,
        repoId: ctx.repoId,
        eventType: "log",
        message: `Loaded ${injection.serverCount} MCP server(s) for Claude Code`,
        payload: {
          stage: "mcp_config",
          outcome: "ok",
          server_count: injection.serverCount,
          server_names: injection.serverNames,
        },
      });
    }
    return injection.mcpConfigPath;
  }

  console.warn("[harness] failed to inject MCP config", {
    sandboxId: ctx.sandboxId,
    error: injection.error,
  });
  await deps.safeAppendAiCallEvent({
    aiCallId: ctx.aiCallId,
    userId: ctx.userId,
    conversationId: ctx.conversationId,
    repoId: ctx.repoId,
    eventType: "log",
    message: `MCP config injection failed: ${injection.error}`,
    payload: {
      stage: "mcp_config",
      outcome: "failed",
      error: injection.error,
    },
  });

  return undefined;
}

export type SlackAttachmentsSetupResult = {
  trimmedPrompt: string;
  deliveryPrompt: string;
};

/**
 * Materializes Slack image attachments and prepares the harness prompt
 * with memory context and delivery instructions.
 */
export async function setupSlackAttachmentsAndPrompt(
  deps: Pick<
    SandboxHarnessPostDeps,
    | "getSlackBotToken"
    | "fetchSlackAttachment"
    | "safeAppendAiCallEvent"
    | "loadHarnessPromptWithMemoryContext"
    | "persistHarnessMemory"
  >,
  sandbox: Sandbox,
  ctx: SandboxSetupContext,
  prompt: string,
  memoryScope: MemoryScope | undefined,
  gitWorkspace: GitWorkspaceSetupResult,
  slackImageAttachments: unknown
): Promise<SlackAttachmentsSetupResult> {
  const slackAttachmentMaterialization =
    await materializeSlackImageAttachmentsForHarness({
      deps,
      sandbox,
      rootDirectory: ctx.rootDirectory,
      attachments: normalizeSlackRunImageAttachmentsMetadata(
        slackImageAttachments
      ),
    });

  if (
    slackAttachmentMaterialization.writtenFiles.length > 0 ||
    slackAttachmentMaterialization.droppedCount > 0 ||
    slackAttachmentMaterialization.unavailableCount > 0
  ) {
    await deps.safeAppendAiCallEvent({
      aiCallId: ctx.aiCallId,
      userId: ctx.userId,
      conversationId: ctx.conversationId,
      repoId: ctx.repoId,
      eventType: "log",
      message: `Materialized ${slackAttachmentMaterialization.writtenFiles.length} Slack image attachment(s)`,
      payload: {
        stage: "slack_attachments",
        written_count: slackAttachmentMaterialization.writtenFiles.length,
        dropped_count: slackAttachmentMaterialization.droppedCount,
        unavailable_count: slackAttachmentMaterialization.unavailableCount,
        files: slackAttachmentMaterialization.writtenFiles.map((file) => ({
          slack_file_id: file.slackFileId,
          path: file.path,
          mimetype: file.mimetype,
          size_bytes: file.sizeBytes,
        })),
      },
    });
  }

  const trimmedPrompt = appendSlackAttachmentPromptSection(
    prompt.trim(),
    slackAttachmentMaterialization.promptSection
  );
  const promptWithMemoryContext = await deps.loadHarnessPromptWithMemoryContext(
    ctx.userId,
    trimmedPrompt,
    memoryScope
  );
  const deliveryPrompt = buildHarnessDeliveryPrompt({
    prompt: promptWithMemoryContext,
    baseBranch: gitWorkspace.baseBranch,
    workingBranch: gitWorkspace.workingBranch,
  });

  void deps.persistHarnessMemory({
    userId: ctx.userId,
    lane: "session",
    content: trimmedPrompt,
    metadata: {
      harness_id: ctx.harnessId,
      kind: "prompt",
    },
    scope: memoryScope,
    source: "harness",
    agent: ctx.harnessId,
  });

  return { trimmedPrompt, deliveryPrompt };
}
