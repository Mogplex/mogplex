import { createHarnessSessionParser } from "@/lib/harness/session-parser";
import {
  appendHarnessFailureOutput,
  presentHarnessFailure,
} from "@/lib/harness/failure";
import { buildAiCallCompletionUpdate } from "@/lib/interactive-runs";
import type { HarnessId } from "@/lib/harness/config";
import type { MemoryScope } from "@/lib/memories-client";
import type { Sandbox, Command } from "@vercel/sandbox";
import type { SandboxHarnessPostDeps } from "./types";
import { isClosedSandboxStreamError, isCancellationRequested } from "./stream";
import type { GitWorkspaceSetupResult } from "./setup";

export type HarnessRunResult = {
  installed: boolean;
  installLogs?: string;
  command: Command;
};

export type StreamExecutionContext = {
  id: string;
  userId: string;
  harnessId: HarnessId;
  conversationId: string | null;
  repoId: string | null;
  rootDirectory: string | null;
  sandboxId: string;
  aiCallId: string;
  aiCallStartedAt: string | null;
  aiCallMetadata: Record<string, unknown>;
  trimmedPrompt: string;
  memoryScope: MemoryScope | undefined;
  runtimeEnv: Record<string, string>;
};

export type FinalizeCancelledRunFn = (input?: {
  runtimeCommandId?: string | null;
  installLogs?: string;
}) => Promise<boolean>;

/**
 * Creates the SSE stream body for harness command execution. Handles
 * log streaming, session parsing, PR delivery, failure detection,
 * and cancellation.
 */
export function createHarnessStreamBody(
  deps: Pick<
    SandboxHarnessPostDeps,
    | "renewSandboxActivityLease"
    | "loadOwnedAiCall"
    | "finalizeAiCallIfNotCancelled"
    | "safeAppendAiCallEvent"
    | "publishHarnessPullRequest"
    | "persistHarnessMemory"
    | "stopSandboxRecord"
  >,
  sandbox: Sandbox,
  result: HarnessRunResult,
  ctx: StreamExecutionContext,
  gitWorkspace: GitWorkspaceSetupResult,
  finalizeCancelledRun: FinalizeCancelledRunFn
): UnderlyingSource<Uint8Array> {
  const encoder = new TextEncoder();

  return {
    async start(controller) {
      const sessionParser = createHarnessSessionParser(ctx.harnessId);
      let failureStdout = "";
      let failureStderr = "";
      let finalFailure: ReturnType<typeof presentHarnessFailure> | null = null;
      let pullRequestUrl: string | null = null;
      let deliveryAutoCommittedFiles: string[] = [];

      try {
        const runEvent = `data: ${JSON.stringify({ type: "run", ai_call_id: ctx.aiCallId })}\n\n`;
        controller.enqueue(encoder.encode(runEvent));

        if (result.installed && result.installLogs) {
          const installEvent = `data: ${JSON.stringify({ type: "install", data: result.installLogs })}\n\n`;
          controller.enqueue(encoder.encode(installEvent));
        }

        for await (const log of result.command.logs()) {
          await deps.renewSandboxActivityLease(sandbox);
          if (log.stream === "stderr") {
            failureStderr = appendHarnessFailureOutput(failureStderr, log.data);
          } else {
            failureStdout = appendHarnessFailureOutput(failureStdout, log.data);
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

        const exitResult = await result.command.wait();
        const currentCall = await deps.loadOwnedAiCall(
          ctx.userId,
          ctx.aiCallId
        );
        const cancelled = isCancellationRequested(currentCall);

        if (!cancelled) {
          if (exitResult.exitCode === 0) {
            const delivery = await deps.publishHarnessPullRequest(sandbox, {
              prompt: ctx.trimmedPrompt,
              baseBranch: gitWorkspace.baseBranch,
              workingBranch: gitWorkspace.workingBranch,
              cwd: ctx.rootDirectory || undefined,
              env: ctx.runtimeEnv,
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
              aiCallId: ctx.aiCallId,
              userId: ctx.userId,
              conversationId: ctx.conversationId,
              repoId: ctx.repoId,
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
                  harnessId: ctx.harnessId,
                  exitCode: exitResult.exitCode,
                  output: failureStderr.trim() ? failureStderr : failureStdout,
                });
          const error = finalFailure?.message ?? null;

          const finalizedCall = await deps.finalizeAiCallIfNotCancelled(
            ctx.aiCallId,
            buildAiCallCompletionUpdate({
              startedAt: ctx.aiCallStartedAt ?? new Date().toISOString(),
              status,
              error,
              runtimeCommandId: result.command.cmdId,
              metadata: {
                ...(currentCall?.metadata ?? ctx.aiCallMetadata),
                base_branch: gitWorkspace.baseBranch,
                working_branch: gitWorkspace.workingBranch,
                pull_request_url: pullRequestUrl,
                auto_committed_files:
                  exitResult.exitCode === 0 ? deliveryAutoCommittedFiles : [],
              },
            })
          );
          if (finalizedCall) {
            await deps.safeAppendAiCallEvent({
              aiCallId: ctx.aiCallId,
              userId: ctx.userId,
              conversationId: ctx.conversationId,
              repoId: ctx.repoId,
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
            userId: ctx.userId,
            lane: "episodic",
            content:
              exitResult.exitCode === 0
                ? `${ctx.harnessId}: ${ctx.trimmedPrompt.slice(0, 160)}`
                : `${ctx.harnessId} failed (${exitResult.exitCode}): ${ctx.trimmedPrompt.slice(0, 160)}`,
            metadata: {
              harness_id: ctx.harnessId,
              kind: "outcome",
              exit_code: exitResult.exitCode,
              prompt_preview: ctx.trimmedPrompt.slice(0, 240),
            },
            scope: ctx.memoryScope,
            source: "harness",
            agent: ctx.harnessId,
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
        await handleStreamError(
          deps,
          ctx,
          result,
          err,
          controller,
          encoder,
          finalizeCancelledRun
        );
      } finally {
        controller.close();
      }
    },
  };
}

async function handleStreamError(
  deps: Pick<
    SandboxHarnessPostDeps,
    | "loadOwnedAiCall"
    | "finalizeAiCallIfNotCancelled"
    | "safeAppendAiCallEvent"
    | "stopSandboxRecord"
  >,
  ctx: StreamExecutionContext,
  result: HarnessRunResult,
  err: unknown,
  controller: { enqueue: (chunk: Uint8Array) => void },
  encoder: TextEncoder,
  finalizeCancelledRun: FinalizeCancelledRunFn
): Promise<void> {
  const rawErrorMsg = err instanceof Error ? err.message : "Stream error";
  const sandboxStreamClosed = isClosedSandboxStreamError(err);
  const errorMsg = sandboxStreamClosed
    ? "The development environment stopped during this agent run. Start it again, then retry."
    : rawErrorMsg;

  console.error("[harness] command stream failed", {
    aiCallId: ctx.aiCallId,
    sandboxRecordId: ctx.id,
    sandboxId: ctx.sandboxId,
    harnessId: ctx.harnessId,
    runtimeCommandId: result.command.cmdId,
    sandboxStreamClosed,
    error: rawErrorMsg,
  });

  if (sandboxStreamClosed) {
    await deps
      .stopSandboxRecord(ctx.id, {
        expectedSandboxId: ctx.sandboxId,
        stopReason: "vm_gone",
        additionalUpdates: {
          last_preview_error:
            "Development environment stopped during the agent run",
          error: errorMsg,
        },
      })
      .catch((stopError) => {
        console.error("[harness] failed to reconcile closed sandbox stream", {
          aiCallId: ctx.aiCallId,
          sandboxRecordId: ctx.id,
          sandboxId: ctx.sandboxId,
          error: stopError,
        });
      });
  }

  const currentCall = await deps.loadOwnedAiCall(ctx.userId, ctx.aiCallId);
  if (isCancellationRequested(currentCall)) {
    await finalizeCancelledRun({
      runtimeCommandId: currentCall?.runtime_command_id ?? result.command.cmdId,
      installLogs: result.installed ? result.installLogs : undefined,
    });
    const cancelledEvent = `data: ${JSON.stringify({ type: "cancelled" })}\n\n`;
    controller.enqueue(encoder.encode(cancelledEvent));
    return;
  }

  const finalizedCall = await deps.finalizeAiCallIfNotCancelled(
    ctx.aiCallId,
    buildAiCallCompletionUpdate({
      startedAt: ctx.aiCallStartedAt ?? new Date().toISOString(),
      status: "failed",
      error: errorMsg,
      metadata: currentCall?.metadata ?? ctx.aiCallMetadata,
    })
  );
  if (finalizedCall) {
    await deps.safeAppendAiCallEvent({
      aiCallId: ctx.aiCallId,
      userId: ctx.userId,
      conversationId: ctx.conversationId,
      repoId: ctx.repoId,
      eventType: "failed",
      message: "Harness stream failed",
      payload: { error: errorMsg },
    });
  }

  const errorEvent = `data: ${JSON.stringify({ type: "error", data: errorMsg })}\n\n`;
  controller.enqueue(encoder.encode(errorEvent));
}
