import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isSandboxCapabilityDeniedError } from "@/lib/sandbox/get-user-credentials";
import { readActiveTeamIdHeader } from "@/lib/team-capabilities";
import { getHarnessConfig } from "@/lib/harness/config";
import { normalizeHarnessExecutionMode } from "@/lib/harness/claude-permissions";
import { HarnessCancelRequestedError } from "@/lib/harness/runner";
import { buildAiCallCompletionUpdate } from "@/lib/interactive-runs";
import { extractVercelApiErrorDetail } from "@/lib/sandbox/api-error";
import { resolveSandboxRecordContext } from "@/lib/sandbox/context";
import {
  buildSandboxRouteErrorResponse,
  loadOwnedSandboxRouteContext,
} from "@/lib/sandbox/route-context";
import type { HarnessId } from "@/lib/harness/config";
import {
  createSandboxBillingOnResume,
  presentSandboxBillingAdmissionError,
} from "@/lib/billing/sandbox-usage";

import {
  VALID_HARNESSES,
  HARNESS_ROUTE_SELECT,
  type HarnessRepoRecord,
  type HarnessSandboxRecord,
  type SandboxHarnessPostDeps,
} from "./_lib/types";
import { buildHarnessMemoryScope } from "./_lib/memory";
import {
  truncateLogEvent,
  isCancellationRequested,
  buildHarnessStreamResponse,
} from "./_lib/stream";
import { defaultSandboxHarnessPostDeps } from "./_lib/deps";
import {
  setupSandboxEnv,
  setupGitDeliveryAuth,
  setupGitWorkspace,
  setupMcpConfig,
  setupSlackAttachmentsAndPrompt,
  type SandboxSetupContext,
} from "./_lib/setup";
import { createHarnessStreamBody } from "./_lib/execution";
import { setupAiCall, createFinalizeCancelledRun } from "./_lib/ai-call";

// Re-export for tests that import directly from route
export { isClosedSandboxStreamError } from "./_lib/stream";

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

    const aiCallResult = await setupAiCall(deps, {
      userId: creds.userId,
      harnessId,
      sandboxRecordId: id,
      sandboxId: record.sandbox_id,
      conversationId: body.conversationId || null,
      repoId: record.repo_id || null,
      repoFullName: repoRecord?.full_name ?? null,
      productTeamId: record.product_team_id ?? null,
      aiBillingSource: harnessAiEnv.aiBillingSource,
      normalizedMode,
      prepareOnly: body.prepareOnly === true,
      existingAiCallId,
    });

    if (!aiCallResult.ok) {
      return NextResponse.json(
        { error: aiCallResult.error },
        { status: aiCallResult.status }
      );
    }

    const { aiCall } = aiCallResult;

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
    const finalizeCancelledRun = createFinalizeCancelledRun(deps, {
      aiCallId: aiCall.id,
      aiCallStartedAt: aiCall.started_at,
      aiCallMetadata: aiCall.metadata,
      userId: creds.userId,
      conversationId: body.conversationId || null,
      repoId: record.repo_id || null,
    });

    const setupCtx: SandboxSetupContext = {
      id,
      userId: creds.userId,
      harnessId,
      conversationId: body.conversationId || null,
      repoId: record.repo_id || null,
      rootDirectory: sandboxData.rootDirectory ?? null,
      sandboxId: record.sandbox_id,
      baseBranch: record.base_branch,
      workingBranch: record.working_branch,
      previewUrl: record.preview_url,
      aiCallId: aiCall.id,
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

      const { runtimeEnv, githubToken } = await setupSandboxEnv(
        deps,
        setupCtx,
        harnessAiEnv,
        repoRecord
      );

      if (!githubToken) {
        throw new Error(
          "GitHub access is required before an agent can deliver changes. Reconnect the repository, then retry."
        );
      }

      await setupGitDeliveryAuth(deps, sandbox, setupCtx, githubToken);
      const gitWorkspace = await setupGitWorkspace(
        deps,
        sandbox,
        setupCtx,
        runtimeEnv
      );
      const mcpConfigPath = await setupMcpConfig(deps, sandbox, setupCtx);
      const { trimmedPrompt, deliveryPrompt } =
        await setupSlackAttachmentsAndPrompt(
          deps,
          sandbox,
          setupCtx,
          prompt,
          memoryScope,
          gitWorkspace,
          body.slackImageAttachments
        );

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

      const streamBody = createHarnessStreamBody(
        deps,
        sandbox,
        result,
        {
          id,
          userId: creds.userId,
          harnessId,
          conversationId: body.conversationId || null,
          repoId: record.repo_id || null,
          rootDirectory: sandboxData.rootDirectory ?? null,
          sandboxId: record.sandbox_id,
          aiCallId: aiCall.id,
          aiCallStartedAt: aiCall.started_at,
          aiCallMetadata: aiCall.metadata ?? {},
          trimmedPrompt,
          memoryScope,
          runtimeEnv,
        },
        gitWorkspace,
        finalizeCancelledRun
      );
      const stream = new ReadableStream(streamBody);

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
        await finalizeCancelledRun({ installLogs: err.installLogs });
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

      if (
        /status code 410/i.test(rawMessage) ||
        /sandbox.*(stopped|gone)/i.test(rawMessage)
      ) {
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
            startedAt: aiCall.started_at ?? new Date().toISOString(),
            status: "failed",
            error: "Sandbox has stopped",
            metadata: aiCall.metadata ?? undefined,
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
          startedAt: aiCall.started_at ?? new Date().toISOString(),
          status: "failed",
          error: message,
          metadata: aiCall.metadata ?? undefined,
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
