"use client";
import { useRef, useState, useCallback } from "react";
import { useSandboxStore } from "@/hooks/use-sandbox";
import { useSessionsStore } from "@/hooks/use-sessions";
import {
  useConversationsStore,
  getHarnessResumeSessionId,
} from "@/hooks/use-conversations";
import { getActiveTeamRequestHeaders } from "@/components/active-scope-provider";
import { useSandboxLaunchActions } from "@/components/sandbox-launch-provider";
import {
  isSandboxUiRuntimeRunning,
  resolveSandboxUiState,
} from "@/lib/sandbox/ui-state";
import { resolveSandboxLaunchIntentFromUiState } from "@/lib/sandbox/launch-intent";
import {
  buildHarnessResumeRetryNotice,
  isRecoverableHarnessResumeFailure,
} from "@/lib/harness/resume-recovery";
import { ensureSessionSandboxBinding } from "@/lib/sandbox/session-retarget";
import type { Repo } from "@/lib/types";
import type { HarnessId } from "@/lib/harness/config";
import { createStreamProcessor, type StreamEvent } from "./stream-processor";

interface UseHarnessRunParams {
  paneId: string;
  model: string;
  mode: "AUTO" | "YOLO" | "SAFE";
  activeRepo?: Pick<Repo, "id"> | null;
  activeSandboxId?: string;
}

export function useHarnessRun({
  paneId,
  model,
  mode,
  activeRepo,
  activeSandboxId,
}: UseHarnessRunParams) {
  const [isHarnessRunning, setIsHarnessRunning] = useState(false);
  const [activeHarnessCallId, setActiveHarnessCallId] = useState<string | null>(
    null
  );
  const [stopError, setStopError] = useState<string | null>(null);

  const activeHarnessCallIdRef = useRef<string | null>(null);
  const harnessAbortRef = useRef<AbortController | null>(null);

  const addLocalMsg = useConversationsStore((state) => state.addLocalMsg);
  const updateLocalMsg = useConversationsStore((state) => state.updateLocalMsg);
  const setHarnessState = useConversationsStore(
    (state) => state.setHarnessState
  );
  const syncConversation = useConversationsStore(
    (state) => state.syncToSupabase
  );
  const activeSessionId = useSessionsStore((state) => state.activeSessionId);
  const { launchRepoSandbox } = useSandboxLaunchActions();

  const harnessState = useConversationsStore(
    useCallback(
      (state) => state.conversations[paneId]?.harnessState ?? {},
      [paneId]
    )
  );

  const executeHarnessRun = useCallback(
    async (input: string) => {
      const harnessId = model.replace("harness:", "") as HarnessId;

      const sessionsSnapshot = useSessionsStore.getState();
      const activeSession =
        sessionsSnapshot.sessions.find(
          (session) => session.id === sessionsSnapshot.activeSessionId
        ) ?? null;
      const currentSandboxRecord = activeSandboxId
        ? useSandboxStore.getState().getSandboxById(activeSandboxId)
        : activeRepo?.id
          ? useSandboxStore.getState().getSandboxForRepo(activeRepo.id)
          : null;
      const currentSandboxState = resolveSandboxUiState({
        session: activeSession,
        record: currentSandboxRecord,
      });
      const sandboxUsable = Boolean(
        currentSandboxRecord && isSandboxUiRuntimeRunning(currentSandboxState)
      );
      let sandboxId = sandboxUsable ? activeSandboxId : undefined;
      const previousSandboxId =
        currentSandboxRecord?.id ?? activeSandboxId ?? null;

      if (!sandboxId) {
        if (!activeRepo?.id) {
          addLocalMsg(paneId, {
            id: crypto.randomUUID(),
            text: "No repo selected. Open a workspace first.",
          });
          return;
        }
        addLocalMsg(paneId, {
          id: crypto.randomUUID(),
          text: "Starting sandbox...",
        });
        const launchOutcome = await launchRepoSandbox(activeRepo as Repo, {
          source: "pane_content",
          trigger: "harness_auto_launch",
          intent: resolveSandboxLaunchIntentFromUiState(
            currentSandboxState,
            currentSandboxRecord?.id
          ),
        });
        if (launchOutcome.status === "cancelled") {
          addLocalMsg(paneId, {
            id: crypto.randomUUID(),
            text: "Sandbox start cancelled.",
          });
          return;
        }
        if (launchOutcome.status !== "launched") {
          addLocalMsg(paneId, {
            id: crypto.randomUUID(),
            text: "Sandbox failed to start. Check Settings for Vercel connection.",
          });
          return;
        }
        ensureSessionSandboxBinding(
          activeSessionId,
          previousSandboxId,
          launchOutcome.sandbox.id
        );
        sandboxId = launchOutcome.sandbox.id;
      }

      const initialResumeSessionId = getHarnessResumeSessionId(
        harnessState,
        harnessId,
        sandboxId ?? null
      );

      addLocalMsg(paneId, { id: crypto.randomUUID(), text: `you: ${input}` });
      const outputMsgId = crypto.randomUUID();
      addLocalMsg(paneId, { id: outputMsgId, text: "▸ running..." });

      const runHarnessAttempt = async (
        resumeSessionId: string | null,
        options?: { allowResumeRetry?: boolean; retryNotice?: string }
      ): Promise<void> => {
        const controller = new AbortController();
        let preparedAiCallId: string | null = null;
        harnessAbortRef.current = controller;
        setStopError(null);

        const cancelPreparedCall = async () => {
          if (!preparedAiCallId) return;
          const callId = preparedAiCallId;
          preparedAiCallId = null;
          if (activeHarnessCallIdRef.current === callId) {
            activeHarnessCallIdRef.current = null;
            setActiveHarnessCallId(null);
          }
          try {
            await fetch(`/api/observability/calls/${callId}/cancel`, {
              method: "POST",
              headers: getActiveTeamRequestHeaders(),
              keepalive: true,
            });
          } catch {
            // Best effort cleanup
          }
        };

        try {
          const prepareRes = await fetch(`/api/sandbox/${sandboxId}/harness`, {
            method: "POST",
            headers: getActiveTeamRequestHeaders({
              "Content-Type": "application/json",
            }),
            body: JSON.stringify({
              harness: harnessId,
              prompt: input,
              conversationId: paneId,
              workspaceSessionId: activeSessionId,
              resumeSessionId,
              mode,
              prepareOnly: true,
            }),
            signal: controller.signal,
          });
          const prepared = (await prepareRes.json().catch(() => ({}))) as {
            aiCallId?: string;
            error?: string;
          };
          if (!prepareRes.ok || !prepared.aiCallId) {
            updateLocalMsg(
              paneId,
              outputMsgId,
              prepared.error || "Harness initialization failed"
            );
            return;
          }

          activeHarnessCallIdRef.current = prepared.aiCallId;
          setActiveHarnessCallId(prepared.aiCallId);
          preparedAiCallId = prepared.aiCallId;

          const res = await fetch(`/api/sandbox/${sandboxId}/harness`, {
            method: "POST",
            headers: getActiveTeamRequestHeaders({
              "Content-Type": "application/json",
            }),
            body: JSON.stringify({
              harness: harnessId,
              prompt: input,
              conversationId: paneId,
              workspaceSessionId: activeSessionId,
              resumeSessionId,
              mode,
              aiCallId: prepared.aiCallId,
            }),
            signal: controller.signal,
          });

          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            const errorText =
              typeof data.error === "string"
                ? data.error
                : "Harness request failed";
            await cancelPreparedCall();

            if (
              options?.allowResumeRetry &&
              resumeSessionId &&
              isRecoverableHarnessResumeFailure(harnessId, errorText)
            ) {
              setHarnessState(paneId, harnessId, null);
              return runHarnessAttempt(null, {
                allowResumeRetry: false,
                retryNotice: buildHarnessResumeRetryNotice(harnessId),
              });
            }

            updateLocalMsg(paneId, outputMsgId, errorText);
            return;
          }

          preparedAiCallId = null;

          if (!res.body) {
            updateLocalMsg(paneId, outputMsgId, "No response stream");
            return;
          }

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          const preludeText = options?.retryNotice
            ? `${options.retryNotice}\n\n`
            : "";

          const processor = createStreamProcessor(harnessId, preludeText, {
            onActiveHarnessCallId: (id) => {
              activeHarnessCallIdRef.current = id;
              setActiveHarnessCallId(id);
            },
            onClearActiveHarnessCallId: () => {
              activeHarnessCallIdRef.current = null;
              setActiveHarnessCallId(null);
            },
            onSessionId: (sessionId, sbId) => {
              setHarnessState(paneId, harnessId, {
                sessionId,
                sandboxId: sbId,
              });
            },
          });

          let buffer = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              try {
                const event = JSON.parse(line.slice(6)) as StreamEvent;
                processor.processEvent(event, sandboxId ?? null);
              } catch {
                // Skip malformed SSE chunks
              }
            }

            updateLocalMsg(paneId, outputMsgId, processor.getCurrentUpdate());
          }

          processor.flush();

          if (
            !processor.state.wasCancelled &&
            options?.allowResumeRetry &&
            resumeSessionId &&
            (processor.state.finalExitCode !== 0 ||
              processor.state.finalError !== null) &&
            isRecoverableHarnessResumeFailure(
              harnessId,
              processor.getResumeFailureMessage()
            )
          ) {
            setHarnessState(paneId, harnessId, null);
            return runHarnessAttempt(null, {
              allowResumeRetry: false,
              retryNotice: buildHarnessResumeRetryNotice(harnessId),
            });
          }

          updateLocalMsg(paneId, outputMsgId, processor.getFinalUpdate());
          await syncConversation(paneId);
        } catch (err) {
          await cancelPreparedCall();
          if (err instanceof DOMException && err.name === "AbortError") {
            updateLocalMsg(paneId, outputMsgId, {
              text: "[cancelled]",
              segments: undefined,
              toolCalls: undefined,
            });
            await syncConversation(paneId);
            return;
          }
          const msg = err instanceof Error ? err.message : "Stream error";
          updateLocalMsg(paneId, outputMsgId, {
            text: msg,
            segments: undefined,
            toolCalls: undefined,
          });
          await syncConversation(paneId);
        } finally {
          harnessAbortRef.current = null;
        }
      };

      await runHarnessAttempt(initialResumeSessionId, {
        allowResumeRetry: Boolean(initialResumeSessionId),
      });
    },
    [
      activeRepo,
      activeSandboxId,
      activeSessionId,
      addLocalMsg,
      harnessState,
      launchRepoSandbox,
      mode,
      model,
      paneId,
      setHarnessState,
      syncConversation,
      updateLocalMsg,
    ]
  );

  const submitToHarness = useCallback(
    async (input: string) => {
      setIsHarnessRunning(true);
      try {
        await executeHarnessRun(input);
      } finally {
        setIsHarnessRunning(false);
        activeHarnessCallIdRef.current = null;
        setActiveHarnessCallId(null);
      }
    },
    [executeHarnessRun]
  );

  const abortHarnessRun = useCallback(() => {
    harnessAbortRef.current?.abort();
  }, []);

  return {
    isHarnessRunning,
    activeHarnessCallId,
    activeHarnessCallIdRef,
    stopError,
    setStopError,
    submitToHarness,
    abortHarnessRun,
  };
}
