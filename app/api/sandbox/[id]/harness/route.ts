import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  getSandboxServiceCredentials,
  isSandboxCapabilityDeniedError,
} from "@/lib/sandbox/get-user-credentials";
import { readActiveTeamIdHeader } from "@/lib/team-capabilities";
import { getSandbox } from "@/lib/sandbox/client";
import { renewSandboxActivityLease } from "@/lib/sandbox/activity-lease";
import { getHarnessConfig } from "@/lib/harness/config";
import { normalizeHarnessExecutionMode } from "@/lib/harness/claude-permissions";
import { HarnessCancelRequestedError, runHarness } from "@/lib/harness/runner";
import { injectClaudeMcpConfig } from "@/lib/harness/mcp-config";
import { getResolvedConnections } from "@/lib/connections/service";
import { createHarnessSessionParser } from "@/lib/harness/session-parser";
import {
  appendHarnessFailureOutput,
  presentHarnessFailure,
} from "@/lib/harness/failure";
import { getGithubAccessTokenForRepo } from "@/lib/github-access";
import { buildRuntimeSandboxEnv } from "@/lib/repo-settings";
import {
  ensureDevTools,
  syncTerminalRuntimeAuth,
} from "@/lib/sandbox/dev-tools";
import { resolveSandboxGitAuthor } from "@/lib/sandbox/git-author";
import {
  buildHarnessDeliveryPrompt,
  publishHarnessPullRequest,
  syncHarnessGitWorkspace,
} from "@/lib/harness/git-delivery";
import {
  stopSandboxRecord,
  touchSandboxLastActive,
} from "@/lib/sandbox/records";
import { resolveRepoSandboxEnv } from "@/lib/vercel/env-vars";
import { getSlackBotToken } from "@/lib/slack/client";
import {
  appendSlackAttachmentPromptSection,
  materializeSlackImageAttachmentsForHarness,
  normalizeSlackRunImageAttachmentsMetadata,
} from "@/lib/slack/run-attachments";
import {
  buildAiCallCompletionUpdate,
  createAiCall,
  finalizeAiCallAsCancelledIfActive,
  finalizeAiCallIfNotCancelled,
  loadOwnedAiCall,
  mergeAiCallMetadata,
  safeAppendAiCallEvent,
  updateAiCall,
} from "@/lib/interactive-runs";
import { resolveSandboxAiAccess } from "@/lib/sandbox/ai-runtime";
import { extractVercelApiErrorDetail } from "@/lib/sandbox/api-error";
import { resolveSandboxRecordContext } from "@/lib/sandbox/context";
import {
  buildSandboxRouteErrorResponse,
  loadOwnedSandboxRouteContext,
} from "@/lib/sandbox/route-context";
import type { HarnessId } from "@/lib/harness/config";
import type { MemoryScope } from "@/lib/memories-client";
import {
  createSandboxBillingOnResume,
  presentSandboxBillingAdmissionError,
} from "@/lib/billing/sandbox-usage";

const VALID_HARNESSES = new Set<HarnessId>(["claude-code", "codex"]);
const MAX_LOG_EVENT_LENGTH = 4000;
const HARNESS_ROUTE_SELECT =
  "repo_id, product_team_id, sandbox_id, root_directory, base_branch, working_branch, billing_source, billing_team_id, billing_project_id, vercel_team_id, vercel_project_id, preview_url, repo:repos(full_name, root_directory, sandbox_env_vars, env_sync_mode, vercel_project_id, vercel_team_id, github_installation_id)";

type HarnessRepoRecord = {
  full_name: string | null;
  root_directory: string | null;
  sandbox_env_vars: unknown;
  env_sync_mode: string | null;
  vercel_project_id?: string | null;
  vercel_team_id?: string | null;
  github_installation_id?: number | null;
};

type HarnessSandboxRecord = {
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

type SandboxHarnessPostDeps = {
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

const defaultSandboxHarnessPostDeps: SandboxHarnessPostDeps = {
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

function truncateLogEvent(value: string) {
  if (value.length <= MAX_LOG_EVENT_LENGTH) return value;
  return `${value.slice(0, MAX_LOG_EVENT_LENGTH)}\n...[truncated ${value.length - MAX_LOG_EVENT_LENGTH} chars]`;
}

export function isClosedSandboxStreamError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /sandbox stream was closed|not accepting commands|sandbox.*(?:stopped|gone)|session.*(?:stopped|gone)/i.test(
    message
  );
}

function isCancellationRequested(
  call: Awaited<ReturnType<typeof loadOwnedAiCall>> | null
) {
  return (
    call?.control_state === "cancel_requested" ||
    call?.control_state === "cancelled" ||
    call?.status === "cancelled"
  );
}

function buildHarnessStreamResponse(input: {
  aiCallId: string;
  installLogs?: string;
  cancelRequested?: boolean;
}) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ type: "run", ai_call_id: input.aiCallId })}\n\n`
        )
      );

      if (input.installLogs) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "install", data: input.installLogs })}\n\n`
          )
        );
      }

      if (input.cancelRequested) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "cancelled" })}\n\n`)
        );
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

function buildHarnessMemoryScope(input: {
  repoId: string | null;
  sandboxId: string;
  conversationId?: string;
  workspaceSessionId?: string | null;
}): MemoryScope | undefined {
  const scope: MemoryScope = {};
  if (input.repoId) scope.repoId = input.repoId;
  if (input.sandboxId) scope.sandboxId = input.sandboxId;
  if (input.conversationId) scope.conversationId = input.conversationId;
  if (input.workspaceSessionId) {
    scope.workspaceSessionId = input.workspaceSessionId;
  }
  return Object.keys(scope).length > 0 ? scope : undefined;
}

function buildHarnessMemoryContextSection(
  context: {
    memories?: Array<{ content: string }>;
  } | null
) {
  if (!context?.memories?.length) return null;
  return [
    "## Relevant Memories",
    ...context.memories.map((memory) => `- ${memory.content}`),
  ].join("\n");
}

function appendHarnessMemoryContext(
  prompt: string,
  memorySection: string | null
) {
  return memorySection
    ? `<memory-context>\n${memorySection}\n</memory-context>\n\n${prompt}`
    : prompt;
}

async function loadHarnessPromptWithMemoryContext(
  userId: string,
  prompt: string,
  scope?: MemoryScope
) {
  try {
    const { loadMemoryContextNative } = await import("@/lib/memories-client");
    const context = await loadMemoryContextNative(
      userId,
      prompt,
      10,
      undefined,
      scope
    );
    return appendHarnessMemoryContext(
      prompt,
      buildHarnessMemoryContextSection(context)
    );
  } catch (error) {
    console.warn("[harness] failed to load memory context", error);
    return prompt;
  }
}

async function persistHarnessMemory(input: {
  userId: string;
  lane: "session" | "episodic";
  content: string;
  metadata?: Record<string, unknown>;
  scope?: MemoryScope;
  source: string;
  agent: string;
}) {
  if (!input.content.trim()) return;

  try {
    const { addToLane, buildLaneScopedMetadata, createMemoriesClient } =
      await import("@/lib/memories-client");

    await addToLane(
      createMemoriesClient(input.userId),
      input.lane,
      input.content,
      buildLaneScopedMetadata(input.lane, input.metadata, {
        ...input.scope,
        source: input.source,
        agent: input.agent,
      }),
      { skipEmbedding: true }
    );
  } catch (error) {
    console.warn("[harness] failed to persist memory", error);
  }
}

export function createSandboxHarnessPostHandler(
  overrides: Partial<SandboxHarnessPostDeps> = {}
) {
  const deps: SandboxHarnessPostDeps = {
    ...defaultSandboxHarnessPostDeps,
    ...overrides,
  };

  return async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
  ) {
    const { id } = await params;
    let creds: Awaited<ReturnType<typeof deps.getSandboxServiceCredentials>>;
    try {
      creds = await deps.getSandboxServiceCredentials(request, {
        allowInternal: true,
        teamId: readActiveTeamIdHeader(request),
        requireCapability: "tools.bash",
      });
    } catch (error) {
      if (isSandboxCapabilityDeniedError(error)) {
        return NextResponse.json(
          { error: error.message },
          { status: error.status }
        );
      }
      throw error;
    }
    if (!creds) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body: {
      harness?: string;
      prompt?: string;
      continue?: boolean;
      conversationId?: string;
      workspaceSessionId?: string | null;
      resumeSessionId?: string | null;
      mode?: string | null;
      aiCallId?: string | null;
      prepareOnly?: boolean;
      slackImageAttachments?: unknown;
    };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const { harness, prompt } = body;

    if (!harness || !VALID_HARNESSES.has(harness as HarnessId)) {
      return NextResponse.json({ error: "Invalid harness" }, { status: 400 });
    }
    if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
      return NextResponse.json(
        { error: "Prompt is required" },
        { status: 400 }
      );
    }

    const harnessId = harness as HarnessId;
    const config = getHarnessConfig(harnessId);
    const normalizedMode = normalizeHarnessExecutionMode(body.mode);
    const existingAiCallId =
      typeof body.aiCallId === "string" && body.aiCallId.trim()
        ? body.aiCallId.trim()
        : null;

    const sandboxData =
      await loadOwnedSandboxRouteContext<HarnessSandboxRecord>(
        request,
        id,
        {
          select: HARNESS_ROUTE_SELECT,
          includeAi: true,
          hydrateSandboxClient: false,
        },
        {
          getSandboxServiceCredentials: async () => creds,
          loadOwnedSandboxRecord: async (sandboxId, userId) =>
            deps.loadOwnedSandboxRecord(sandboxId, userId),
          getSandbox: deps.getSandbox,
          resolveSandboxRecordContext: (input) =>
            resolveSandboxRecordContext(input, {
              resolveSandboxAiAccess: deps.resolveSandboxAiAccess,
            }),
        }
      );
    if (!sandboxData.ok) {
      return buildSandboxRouteErrorResponse(sandboxData);
    }

    const { context, record } = sandboxData;
    const repoRecord = sandboxData.repo as HarnessRepoRecord | null;
    const memoryScope = buildHarnessMemoryScope({
      repoId: record.repo_id || null,
      sandboxId: record.sandbox_id,
      conversationId: body.conversationId,
      workspaceSessionId: body.workspaceSessionId ?? null,
    });
    if (!("ai" in context)) {
      return NextResponse.json(
        { error: "Sandbox AI context unavailable" },
        { status: 500 }
      );
    }
    const harnessAiEnv = context.ai.buildHarnessEnv(harnessId);
    if (!harnessAiEnv.ok) {
      return NextResponse.json({ error: harnessAiEnv.error }, { status: 401 });
    }

    const existingAiCall = existingAiCallId
      ? await deps.loadOwnedAiCall(creds.userId, existingAiCallId)
      : null;
    if (existingAiCallId && !existingAiCall) {
      return NextResponse.json({ error: "ai_call not found" }, { status: 404 });
    }
    const isPreparedCliCall =
      existingAiCall?.metadata?.source === "cli" &&
      existingAiCall.metadata?.prepared === true &&
      existingAiCall.metadata?.sandbox_record_id === id &&
      existingAiCall.metadata?.harness_id === harnessId;
    if (
      existingAiCall &&
      existingAiCall.metadata?.source !== "external-api" &&
      !isPreparedCliCall
    ) {
      return NextResponse.json(
        { error: "ai_call is not available for this harness run" },
        { status: 409 }
      );
    }
    if (existingAiCall && existingAiCall.status !== "pending") {
      return NextResponse.json(
        { error: "ai_call is not pending" },
        { status: 409 }
      );
    }

    const harnessMetadataPatch = {
      source: "cli",
      harness_id: harnessId,
      harness_mode: normalizedMode,
      sandbox_record_id: id,
      sandbox_id: record.sandbox_id,
      repo: repoRecord?.full_name ?? null,
      product_team_id: record.product_team_id ?? null,
      ai_billing_source: harnessAiEnv.aiBillingSource,
    };
    const createdAiCallMetadata = {
      ...existingAiCall?.metadata,
      ...harnessMetadataPatch,
      prepared: body.prepareOnly === true,
    };

    const aiCall = existingAiCall
      ? await deps.mergeAiCallMetadata({
          userId: creds.userId,
          aiCallId: existingAiCall.id,
          metadata: harnessMetadataPatch,
        })
      : await deps.createAiCall({
          userId: creds.userId,
          type: "agent",
          model: `harness:${harnessId}`,
          conversationId: body.conversationId || null,
          repoId: record.repo_id || null,
          status: "pending",
          metadata: createdAiCallMetadata,
        });

    if (!aiCall) {
      console.error("[harness] failed to merge existing ai_call metadata", {
        aiCallId: existingAiCall?.id ?? null,
        sandboxRecordId: id,
        userId: creds.userId,
      });
      return NextResponse.json(
        { error: "Harness initialization failed" },
        { status: 500 }
      );
    }

    if (body.prepareOnly === true) {
      return NextResponse.json({ aiCallId: aiCall.id });
    }

    await deps.safeAppendAiCallEvent({
      aiCallId: aiCall.id,
      userId: creds.userId,
      conversationId: body.conversationId || null,
      repoId: record.repo_id || null,
      eventType: "started",
      message: `Harness run started: ${harnessId}`,
      payload: {
        harness_id: harnessId,
        ai_billing_source: harnessAiEnv.aiBillingSource,
      },
    });

    const loadCurrentCall = () => deps.loadOwnedAiCall(creds.userId, aiCall.id);
    const finalizeCancelledRun = async (input?: {
      runtimeCommandId?: string | null;
      installLogs?: string;
    }) => {
      const currentCall = await loadCurrentCall();
      const cancelRequestedAt =
        currentCall?.cancel_requested_at ?? new Date().toISOString();

      const cancelledCall = await deps.finalizeAiCallAsCancelledIfActive(
        aiCall.id,
        buildAiCallCompletionUpdate({
          startedAt: aiCall.started_at,
          status: "cancelled",
          cancelRequestedAt,
          controlState: "cancelled",
          runtimeCommandId:
            input?.runtimeCommandId ?? currentCall?.runtime_command_id ?? null,
          metadata: currentCall?.metadata ?? aiCall.metadata,
        })
      );

      if (!cancelledCall) return false;

      await deps.safeAppendAiCallEvent({
        aiCallId: aiCall.id,
        userId: creds.userId,
        conversationId: body.conversationId || null,
        repoId: record.repo_id || null,
        eventType: "cancelled",
        message: "Harness run cancelled",
        payload: {
          runtime_command_id: input?.runtimeCommandId ?? null,
          install_logs_present: Boolean(input?.installLogs),
        },
      });

      return true;
    };

    try {
      if (record.sandbox_id === "pending") {
        return NextResponse.json(
          { error: "Sandbox is not ready" },
          { status: 409 }
        );
      }

      const sandbox = await deps.getSandbox(
        record.sandbox_id,
        {
          vercelToken: context.credentials.vercelToken,
          vercelTeamId: context.credentials.vercelTeamId,
          vercelProjectId: context.credentials.vercelProjectId,
        },
        { onResume: createSandboxBillingOnResume(id) }
      );

      await deps.renewSandboxActivityLease(sandbox);
      await deps.touchSandboxLastActive(id);

      const envResolution = await deps.resolveRepoSandboxEnv({
        repo: repoRecord ?? {},
        userId: creds.userId,
      });
      const runtimeEnv = buildRuntimeSandboxEnv(
        envResolution.envVars,
        envResolution.sync.mode,
        record.preview_url
      );
      Object.assign(runtimeEnv, harnessAiEnv.env, {
        MOGPLEX_AI_BILLING_SOURCE: harnessAiEnv.aiBillingSource,
      });

      // Intentional: inject a short-lived (~1h) GitHub App installation
      // access token into the sandbox so harness agents (Claude Code, Codex)
      // — and any user-authored scripts the agent runs — can use `gh` or
      // `curl` against the GitHub API. The token is installation-scoped to
      // the GH App's permissions on this repo's installation, not a user
      // PAT. It expires shortly after the run ends, and is never returned
      // to the client or logged. Delivery is part of a successful harness
      // run, so missing GitHub access fails before the agent edits files.
      let githubToken: string | null = null;
      if (repoRecord?.github_installation_id) {
        try {
          githubToken = await deps.getGithubAccessTokenForRepo({
            user_id: creds.userId,
            github_installation_id: repoRecord.github_installation_id,
          });
          if (githubToken) {
            runtimeEnv.GITHUB_TOKEN = githubToken;
            runtimeEnv.GH_TOKEN = githubToken;
          }
        } catch (err) {
          console.warn("[harness] failed to mint github installation token", {
            sandboxId: record.sandbox_id,
            error: err instanceof Error ? err.message : err,
          });
        }
      }

      // Make the sandbox capable of GH work: install gh CLI and wire git
      // to use the injected installation token for HTTPS auth. Idempotent
      // so it's cheap on subsequent runs of the same sandbox.
      if (githubToken) {
        const gitAuthor = await deps.resolveSandboxGitAuthor(creds.userId);
        const devToolsResult = await deps.ensureDevTools(sandbox, {
          agentName: gitAuthor.name,
          agentEmail: gitAuthor.email,
        });
        if (!devToolsResult.ok) {
          console.warn("[harness] ensureDevTools failed", {
            sandboxId: record.sandbox_id,
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
      } else {
        throw new Error(
          "GitHub access is required before an agent can deliver changes. Reconnect the repository, then retry."
        );
      }

      const gitWorkspace = await deps.syncHarnessGitWorkspace(sandbox, {
        aiCallId: aiCall.id,
        baseBranch: record.base_branch,
        workingBranch: record.working_branch,
        cwd: sandboxData.rootDirectory || undefined,
        env: runtimeEnv,
      });
      if (gitWorkspace.createdBranch) {
        await deps.updateSandboxWorkingBranch({
          recordId: id,
          userId: creds.userId,
          sandboxId: record.sandbox_id,
          workingBranch: gitWorkspace.workingBranch,
        });
      }
      await deps.safeAppendAiCallEvent({
        aiCallId: aiCall.id,
        userId: creds.userId,
        conversationId: body.conversationId || null,
        repoId: record.repo_id || null,
        eventType: "log",
        message: `Synchronized ${gitWorkspace.workingBranch}`,
        payload: {
          stage: "git_sync",
          base_branch: gitWorkspace.baseBranch,
          working_branch: gitWorkspace.workingBranch,
          created_branch: gitWorkspace.createdBranch,
        },
      });

      // Inject user-connected MCP servers for Claude Code. Always overwrites
      // .mogplex/mcp.json so bearer tokens from prior runs can't outlive the
      // connection. Codex uses a different MCP config format (TOML,
      // stdio-only) and is handled separately.
      let mcpConfigPath: string | undefined;
      if (harnessId === "claude-code") {
        if (record.repo_id) {
          const injection = await deps.injectClaudeMcpConfig(sandbox, {
            userId: creds.userId,
            repoId: record.repo_id,
            rootDirectory: sandboxData.rootDirectory,
            resolveConnections: deps.getResolvedConnections,
          });
          if (injection.ok) {
            mcpConfigPath = injection.mcpConfigPath;
            if (injection.serverCount > 0) {
              await deps.safeAppendAiCallEvent({
                aiCallId: aiCall.id,
                userId: creds.userId,
                conversationId: body.conversationId || null,
                repoId: record.repo_id || null,
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
          } else {
            // Mirror the success-path emit so an operator querying
            // ai_call_events for stage='mcp_config' sees both
            // outcomes. Without this the harness silently runs without
            // user MCPs and the only signal is a console.warn that
            // doesn't survive into observability surfaces.
            console.warn("[harness] failed to inject MCP config", {
              sandboxId: record.sandbox_id,
              error: injection.error,
            });
            await deps.safeAppendAiCallEvent({
              aiCallId: aiCall.id,
              userId: creds.userId,
              conversationId: body.conversationId || null,
              repoId: record.repo_id || null,
              eventType: "log",
              message: `MCP config injection failed: ${injection.error}`,
              payload: {
                stage: "mcp_config",
                outcome: "failed",
                error: injection.error,
              },
            });
          }
        } else {
          // Mogplex sandboxes are always bound to a repo; this path is a
          // schema invariant violation. Log so it doesn't silently swallow
          // user-configured MCPs.
          console.warn(
            "[harness] skipping MCP injection: claude-code sandbox has no repo_id",
            { sandboxId: record.sandbox_id }
          );
        }
      }

      const slackAttachmentMaterialization =
        await materializeSlackImageAttachmentsForHarness({
          deps,
          sandbox,
          rootDirectory: sandboxData.rootDirectory,
          attachments: normalizeSlackRunImageAttachmentsMetadata(
            body.slackImageAttachments
          ),
        });
      if (
        slackAttachmentMaterialization.writtenFiles.length > 0 ||
        slackAttachmentMaterialization.droppedCount > 0 ||
        slackAttachmentMaterialization.unavailableCount > 0
      ) {
        await deps.safeAppendAiCallEvent({
          aiCallId: aiCall.id,
          userId: creds.userId,
          conversationId: body.conversationId || null,
          repoId: record.repo_id || null,
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
      const promptWithMemoryContext =
        await deps.loadHarnessPromptWithMemoryContext(
          creds.userId,
          trimmedPrompt,
          memoryScope
        );
      const deliveryPrompt = buildHarnessDeliveryPrompt({
        prompt: promptWithMemoryContext,
        baseBranch: gitWorkspace.baseBranch,
        workingBranch: gitWorkspace.workingBranch,
      });

      void deps.persistHarnessMemory({
        userId: creds.userId,
        lane: "session",
        content: trimmedPrompt,
        metadata: {
          harness_id: harnessId,
          kind: "prompt",
        },
        scope: memoryScope,
        source: "harness",
        agent: harnessId,
      });

      const result = await deps.runHarness(
        sandbox,
        harnessId,
        deliveryPrompt,
        harnessAiEnv.env,
        {
          continue: body.continue,
          resumeSessionId: body.resumeSessionId,
          mode: normalizedMode,
          cwd: sandboxData.rootDirectory || undefined,
          runtimeEnv,
          mcpConfigPath,
          shouldCancel: async () =>
            isCancellationRequested(await loadCurrentCall()),
        }
      );

      const currentCall = await loadCurrentCall();
      if (isCancellationRequested(currentCall)) {
        try {
          await result.command.kill();
        } catch (error) {
          console.warn(
            "[harness] failed to kill command after pending cancellation",
            { aiCallId: aiCall.id, error }
          );
        }
        await finalizeCancelledRun({
          runtimeCommandId: result.command.cmdId,
          installLogs: result.installed ? result.installLogs : undefined,
        });
        return buildHarnessStreamResponse({
          aiCallId: aiCall.id,
          installLogs: result.installed ? result.installLogs : undefined,
          cancelRequested: true,
        });
      }

      await deps.updateAiCall(aiCall.id, {
        status: "streaming",
        runtime_command_id: result.command.cmdId,
      });
      await deps.safeAppendAiCallEvent({
        aiCallId: aiCall.id,
        userId: creds.userId,
        conversationId: body.conversationId || null,
        repoId: record.repo_id || null,
        eventType: "status_changed",
        message: "Harness run streaming",
        payload: {
          from: "pending",
          to: "streaming",
          runtime_command_id: result.command.cmdId,
        },
      });

      if (result.installed && result.installLogs) {
        await deps.safeAppendAiCallEvent({
          aiCallId: aiCall.id,
          userId: creds.userId,
          conversationId: body.conversationId || null,
          repoId: record.repo_id || null,
          eventType: "log",
          message: `Installed ${config.package}`,
          payload: {
            stage: "install",
            logs: truncateLogEvent(result.installLogs),
          },
        });
      }

      // Stream logs via SSE
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          const sessionParser = createHarnessSessionParser(harnessId);
          let failureStdout = "";
          let failureStderr = "";
          let finalFailure: ReturnType<typeof presentHarnessFailure> | null =
            null;
          let pullRequestUrl: string | null = null;
          let deliveryAutoCommittedFiles: string[] = [];

          try {
            const runEvent = `data: ${JSON.stringify({ type: "run", ai_call_id: aiCall.id })}\n\n`;
            controller.enqueue(encoder.encode(runEvent));

            // Send install logs if harness was just installed
            if (result.installed && result.installLogs) {
              const installEvent = `data: ${JSON.stringify({ type: "install", data: result.installLogs })}\n\n`;
              controller.enqueue(encoder.encode(installEvent));
            }

            // Stream command output
            for await (const log of result.command.logs()) {
              await deps.renewSandboxActivityLease(sandbox);
              if (log.stream === "stderr") {
                failureStderr = appendHarnessFailureOutput(
                  failureStderr,
                  log.data
                );
              } else {
                failureStdout = appendHarnessFailureOutput(
                  failureStdout,
                  log.data
                );
              }
              const sessionId = sessionParser.push(log.stream, log.data);
              if (sessionId) {
                const sessionEvent = `data: ${JSON.stringify({ type: "session", sessionId })}\n\n`;
                controller.enqueue(encoder.encode(sessionEvent));
              }
              const event = `data: ${JSON.stringify({ type: "log", stream: log.stream, data: log.data })}\n\n`;
              controller.enqueue(encoder.encode(event));
            }

            const finalSessionId = sessionParser.flush();
            if (finalSessionId) {
              const sessionEvent = `data: ${JSON.stringify({ type: "session", sessionId: finalSessionId })}\n\n`;
              controller.enqueue(encoder.encode(sessionEvent));
            }

            // Send completion
            const exitResult = await result.command.wait();
            const currentCall = await deps.loadOwnedAiCall(
              creds.userId,
              aiCall.id
            );
            const cancelled = isCancellationRequested(currentCall);

            if (!cancelled) {
              if (exitResult.exitCode === 0) {
                const delivery = await deps.publishHarnessPullRequest(sandbox, {
                  prompt: trimmedPrompt,
                  baseBranch: gitWorkspace.baseBranch,
                  workingBranch: gitWorkspace.workingBranch,
                  cwd: sandboxData.rootDirectory || undefined,
                  env: runtimeEnv,
                });
                pullRequestUrl = delivery.pullRequestUrl;
                deliveryAutoCommittedFiles = delivery.autoCommittedFiles;
                if (delivery.autoCommittedFiles.length > 0) {
                  const autoCommitEvent = `data: ${JSON.stringify({
                    type: "log",
                    stream: "stdout",
                    data: `Delivered tracked changes in an automatic commit:\n${delivery.autoCommittedFiles
                      .map((file) => `- ${file}`)
                      .join("\n")}\n`,
                  })}\n\n`;
                  controller.enqueue(encoder.encode(autoCommitEvent));
                }
                await deps.safeAppendAiCallEvent({
                  aiCallId: aiCall.id,
                  userId: creds.userId,
                  conversationId: body.conversationId || null,
                  repoId: record.repo_id || null,
                  eventType: "log",
                  message: pullRequestUrl
                    ? "Pull request ready"
                    : "No code changes to deliver",
                  payload: {
                    stage: "git_delivery",
                    changed: delivery.changed,
                    pull_request_url: pullRequestUrl,
                    base_branch: gitWorkspace.baseBranch,
                    working_branch: gitWorkspace.workingBranch,
                    auto_committed_files: delivery.autoCommittedFiles,
                  },
                });
              }
              const status = exitResult.exitCode === 0 ? "success" : "failed";
              finalFailure =
                exitResult.exitCode === 0
                  ? null
                  : presentHarnessFailure({
                      harnessId,
                      exitCode: exitResult.exitCode,
                      output: failureStderr.trim()
                        ? failureStderr
                        : failureStdout,
                    });
              const error = finalFailure?.message ?? null;

              const finalizedCall = await deps.finalizeAiCallIfNotCancelled(
                aiCall.id,
                buildAiCallCompletionUpdate({
                  startedAt: aiCall.started_at,
                  status,
                  error,
                  runtimeCommandId: result.command.cmdId,
                  metadata: {
                    ...(currentCall?.metadata ?? aiCall.metadata),
                    base_branch: gitWorkspace.baseBranch,
                    working_branch: gitWorkspace.workingBranch,
                    pull_request_url: pullRequestUrl,
                    auto_committed_files:
                      exitResult.exitCode === 0
                        ? deliveryAutoCommittedFiles
                        : [],
                  },
                })
              );
              if (finalizedCall) {
                await deps.safeAppendAiCallEvent({
                  aiCallId: aiCall.id,
                  userId: creds.userId,
                  conversationId: body.conversationId || null,
                  repoId: record.repo_id || null,
                  eventType: status === "failed" ? "failed" : "finished",
                  message:
                    status === "failed"
                      ? "Harness run failed"
                      : "Harness run finished",
                  payload: {
                    exit_code: exitResult.exitCode,
                    failure_code: finalFailure?.code ?? null,
                  },
                });
              }

              await deps.persistHarnessMemory({
                userId: creds.userId,
                lane: "episodic",
                content:
                  exitResult.exitCode === 0
                    ? `${harnessId}: ${trimmedPrompt.slice(0, 160)}`
                    : `${harnessId} failed (${exitResult.exitCode}): ${trimmedPrompt.slice(0, 160)}`,
                metadata: {
                  harness_id: harnessId,
                  kind: "outcome",
                  exit_code: exitResult.exitCode,
                  prompt_preview: trimmedPrompt.slice(0, 240),
                },
                scope: memoryScope,
                source: "harness",
                agent: harnessId,
              });
            }

            if (cancelled) {
              await finalizeCancelledRun({
                runtimeCommandId: result.command.cmdId,
                installLogs: result.installed ? result.installLogs : undefined,
              });
              const cancelledEvent = `data: ${JSON.stringify({ type: "cancelled" })}\n\n`;
              controller.enqueue(encoder.encode(cancelledEvent));
            } else {
              const doneEvent = `data: ${JSON.stringify({
                type: "done",
                exitCode: exitResult.exitCode,
                error: finalFailure?.message ?? null,
                failureCode: finalFailure?.code ?? null,
                ...(pullRequestUrl ? { pullRequestUrl } : {}),
              })}\n\n`;
              controller.enqueue(encoder.encode(doneEvent));
            }
          } catch (err) {
            const rawErrorMsg =
              err instanceof Error ? err.message : "Stream error";
            const sandboxStreamClosed = isClosedSandboxStreamError(err);
            const errorMsg = sandboxStreamClosed
              ? "The development environment stopped during this agent run. Start it again, then retry."
              : rawErrorMsg;
            console.error("[harness] command stream failed", {
              aiCallId: aiCall.id,
              sandboxRecordId: id,
              sandboxId: record.sandbox_id,
              harnessId,
              runtimeCommandId: result.command.cmdId,
              sandboxStreamClosed,
              error: rawErrorMsg,
            });
            if (sandboxStreamClosed) {
              await deps
                .stopSandboxRecord(id, {
                  expectedSandboxId: record.sandbox_id,
                  stopReason: "vm_gone",
                  additionalUpdates: {
                    last_preview_error:
                      "Development environment stopped during the agent run",
                    error: errorMsg,
                  },
                })
                .catch((stopError) => {
                  console.error(
                    "[harness] failed to reconcile closed sandbox stream",
                    {
                      aiCallId: aiCall.id,
                      sandboxRecordId: id,
                      sandboxId: record.sandbox_id,
                      error: stopError,
                    }
                  );
                });
            }
            const currentCall = await deps.loadOwnedAiCall(
              creds.userId,
              aiCall.id
            );
            if (isCancellationRequested(currentCall)) {
              await finalizeCancelledRun({
                runtimeCommandId:
                  currentCall?.runtime_command_id ?? result.command.cmdId,
                installLogs: result.installed ? result.installLogs : undefined,
              });
              const cancelledEvent = `data: ${JSON.stringify({ type: "cancelled" })}\n\n`;
              controller.enqueue(encoder.encode(cancelledEvent));
              return;
            }
            const finalizedCall = await deps.finalizeAiCallIfNotCancelled(
              aiCall.id,
              buildAiCallCompletionUpdate({
                startedAt: aiCall.started_at,
                status: "failed",
                error: errorMsg,
                metadata: currentCall?.metadata ?? aiCall.metadata,
              })
            );
            if (finalizedCall) {
              await deps.safeAppendAiCallEvent({
                aiCallId: aiCall.id,
                userId: creds.userId,
                conversationId: body.conversationId || null,
                repoId: record.repo_id || null,
                eventType: "failed",
                message: "Harness stream failed",
                payload: { error: errorMsg },
              });
            }

            const errorEvent = `data: ${JSON.stringify({ type: "error", data: errorMsg })}\n\n`;
            controller.enqueue(encoder.encode(errorEvent));
          } finally {
            controller.close();
          }
        },
      });

      // Touch last_active_at (best-effort, don't block response)
      void deps.touchSandboxLastActive(id).catch((error) => {
        console.warn("[harness] failed to touch sandbox last_active_at", {
          sandboxId: id,
          error,
        });
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    } catch (err) {
      if (err instanceof HarnessCancelRequestedError) {
        await finalizeCancelledRun({
          installLogs: err.installLogs,
        });
        return buildHarnessStreamResponse({
          aiCallId: aiCall.id,
          installLogs: err.installLogs,
          cancelRequested: true,
        });
      }

      const billingError = presentSandboxBillingAdmissionError(err);
      const rawMessage =
        billingError?.message ??
        (err instanceof Error ? err.message : "Harness execution failed");
      const apiDetail = extractVercelApiErrorDetail(err);
      const message = apiDetail ? `${rawMessage} — ${apiDetail}` : rawMessage;

      console.error("[harness] execution failed", {
        aiCallId: aiCall.id,
        sandboxRecordId: id,
        sandboxId: record.sandbox_id,
        harnessId,
        message: rawMessage,
        apiDetail,
      });

      // Detect stopped sandbox (Vercel SDK returns "Status code 410" for stopped sandboxes)
      if (
        /status code 410/i.test(rawMessage) ||
        /sandbox.*(stopped|gone)/i.test(rawMessage)
      ) {
        // Mark sandbox as stopped in DB (best-effort)
        supabaseAdmin
          .from("sandboxes")
          .update({ status: "stopped" })
          .eq("id", id)
          .then(({ error }) => {
            if (error)
              console.warn("Failed to mark sandbox stopped:", error.message);
          });

        await deps.finalizeAiCallIfNotCancelled(
          aiCall.id,
          buildAiCallCompletionUpdate({
            startedAt: aiCall.started_at,
            status: "failed",
            error: "Sandbox has stopped",
            metadata: aiCall.metadata,
          })
        );
        return NextResponse.json(
          { error: "Sandbox has stopped. Launch a new sandbox to continue." },
          { status: 410 }
        );
      }
      const finalizedCall = await deps.finalizeAiCallIfNotCancelled(
        aiCall.id,
        buildAiCallCompletionUpdate({
          startedAt: aiCall.started_at,
          status: "failed",
          error: message,
          metadata: aiCall.metadata,
        })
      );
      if (finalizedCall) {
        await deps.safeAppendAiCallEvent({
          aiCallId: aiCall.id,
          userId: creds.userId,
          conversationId: body.conversationId || null,
          repoId: record.repo_id || null,
          eventType: "failed",
          message: "Harness execution failed",
          payload: { error: message },
        });
      }
      return NextResponse.json(
        { error: message },
        { status: billingError?.status ?? 500 }
      );
    }
  };
}

export const POST = createSandboxHarnessPostHandler();
