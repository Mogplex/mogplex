"use client";

import { useCallback, useRef } from "react";
import { useSandboxStore } from "@/hooks/use-sandbox";
import { useSessionsStore } from "@/hooks/use-sessions";
import { shouldWarnAboutDevServerCommand } from "@/lib/sandbox/dev-server-guard";
import {
  bindSessionToPendingSandboxBranch,
  ensureSessionSandboxBinding,
} from "@/lib/sandbox/session-retarget";
import {
  getSandboxUiPreviewUrl,
  resolveSandboxUiState,
} from "@/lib/sandbox/ui-state";
import { ANSI, commandHistory, MAX_HISTORY } from "@/lib/terminal/styles";

type InputRefs = {
  sandboxIdRef: React.RefObject<string | null | undefined>;
  repoIdRef: React.RefObject<string | null | undefined>;
  workingBranchRef: React.RefObject<string | null | undefined>;
  sandboxStatusRef: React.RefObject<string | null | undefined>;
  currentCmdIdRef: React.RefObject<string | null>;
  pendingCommandRef: React.MutableRefObject<string | null>;
};

type InputCallbacks = {
  write: (data: string) => void;
  writeln: (data: string) => void;
  writePrompt: () => void;
  execInSandbox: (command: string) => Promise<void>;
  cancelCurrentRun: () => Promise<boolean>;
  openDevServerConfirmation: (command: string) => boolean;
};

export function useTerminalInput(refs: InputRefs, callbacks: InputCallbacks) {
  const {
    sandboxIdRef,
    repoIdRef,
    workingBranchRef,
    sandboxStatusRef,
    currentCmdIdRef,
    pendingCommandRef,
  } = refs;
  const {
    write,
    writeln,
    writePrompt,
    execInSandbox,
    cancelCurrentRun,
    openDevServerConfirmation,
  } = callbacks;

  const activeSessionId = useSessionsStore((state) => state.activeSessionId);
  const inputBuffer = useRef("");
  const historyIdx = useRef(-1);

  const replaceInput = useCallback(
    (newValue: string) => {
      if (inputBuffer.current.length > 0) {
        write("\b \b".repeat(inputBuffer.current.length));
      }
      inputBuffer.current = newValue;
      write(newValue);
    },
    [write]
  );

  const queueCommand = useCallback(
    (command: string) => {
      pendingCommandRef.current = command;
    },
    [pendingCommandRef]
  );

  const getHealthyPreviewUrl = useCallback(() => {
    const currentSandboxId = sandboxIdRef.current;
    if (!currentSandboxId) return null;
    const sandbox = useSandboxStore.getState().getSandboxById(currentSandboxId);
    const uiState = resolveSandboxUiState({ session: null, record: sandbox });
    if (uiState.kind !== "live") return null;
    return getSandboxUiPreviewUrl(uiState) ?? null;
  }, [sandboxIdRef]);

  const handleLocalInput = useCallback(
    (data: string) => {
      if (data === "\r") {
        const command = inputBuffer.current.trim();
        inputBuffer.current = "";
        historyIdx.current = -1;

        if (command && commandHistory[0] !== command) {
          commandHistory.unshift(command);
          if (commandHistory.length > MAX_HISTORY) commandHistory.pop();
        }

        if (!command) {
          write("\r\n");
          writePrompt();
          return;
        }

        const currentSandboxId = sandboxIdRef.current;
        const currentRepoId = repoIdRef.current;
        const currentWorkingBranch = workingBranchRef.current;
        const currentStatus = sandboxStatusRef.current;
        const currentSandbox = currentSandboxId
          ? useSandboxStore.getState().getSandboxById(currentSandboxId)
          : null;
        const pendingBranchSandbox =
          currentRepoId && currentWorkingBranch && !currentSandboxId
            ? useSandboxStore.getState().getSandboxForRepo(currentRepoId, {
                workingBranch: currentWorkingBranch,
              })
            : null;
        const previousSandboxId =
          currentSandboxId ?? pendingBranchSandbox?.id ?? null;

        const previewUrl = getHealthyPreviewUrl();
        if (
          currentSandboxId &&
          currentStatus === "running" &&
          shouldWarnAboutDevServerCommand(command, previewUrl, "running") &&
          openDevServerConfirmation(command)
        ) {
          write("\r\n");
          return;
        }

        if (currentSandboxId && currentStatus === "running") {
          void execInSandbox(command);
          return;
        }

        if (
          (currentSandboxId || currentWorkingBranch) &&
          (currentStatus === "creating" || currentStatus === "installing")
        ) {
          queueCommand(command);
          write("\r\n");
          writeln(
            `${ANSI.YELLOW}▸ Sandbox is still starting. Command queued...${ANSI.RESET}`
          );
          return;
        }

        if (
          currentRepoId &&
          (currentSandboxId || pendingBranchSandbox?.id) &&
          (currentStatus === "stopped" || currentStatus === "error")
        ) {
          queueCommand(command);
          write("\r\n");
          writeln(
            `${ANSI.YELLOW}▸ Restarting sandbox to run command...${ANSI.RESET}`
          );
          void (async () => {
            bindSessionToPendingSandboxBranch(
              activeSessionId,
              currentSandbox?.working_branch ??
                pendingBranchSandbox?.working_branch ??
                null
            );
            const restartedSandbox = await useSandboxStore
              .getState()
              .restart(currentRepoId, { sandboxId: previousSandboxId });
            if (!restartedSandbox?.id) return;
            ensureSessionSandboxBinding(
              activeSessionId,
              previousSandboxId,
              restartedSandbox.id
            );
          })();
          return;
        }

        if (currentRepoId) {
          queueCommand(command);
          write("\r\n");
          writeln(
            `${ANSI.YELLOW}▸ Starting sandbox to run command...${ANSI.RESET}`
          );
          void (async () => {
            const launchedSandbox = await useSandboxStore
              .getState()
              .launch(currentRepoId);
            if (!launchedSandbox?.id) return;
            ensureSessionSandboxBinding(
              activeSessionId,
              previousSandboxId,
              launchedSandbox.id
            );
          })();
          return;
        }

        write("\r\n");
        writeln(`${ANSI.GRAY}No repo selected${ANSI.RESET}`);
        writePrompt();
        return;
      }

      if (data === "[A") {
        if (historyIdx.current < commandHistory.length - 1) {
          historyIdx.current += 1;
          replaceInput(commandHistory[historyIdx.current]);
        }
        return;
      }

      if (data === "[B") {
        if (historyIdx.current > 0) {
          historyIdx.current -= 1;
          replaceInput(commandHistory[historyIdx.current]);
        } else if (historyIdx.current === 0) {
          historyIdx.current = -1;
          replaceInput("");
        }
        return;
      }

      if (data === "") {
        if (inputBuffer.current.length > 0) {
          inputBuffer.current = inputBuffer.current.slice(0, -1);
          write("\b \b");
        }
        return;
      }

      if (data === "") {
        if (currentCmdIdRef.current) {
          void cancelCurrentRun();
          return;
        }
        inputBuffer.current = "";
        historyIdx.current = -1;
        writeln("^C");
        writePrompt();
        return;
      }

      if (data >= " ") {
        inputBuffer.current += data;
        write(data);
      }
    },
    [
      activeSessionId,
      cancelCurrentRun,
      currentCmdIdRef,
      execInSandbox,
      getHealthyPreviewUrl,
      openDevServerConfirmation,
      queueCommand,
      replaceInput,
      sandboxIdRef,
      repoIdRef,
      workingBranchRef,
      sandboxStatusRef,
      write,
      writeln,
      writePrompt,
    ]
  );

  return {
    handleLocalInput,
    inputBuffer,
    historyIdx,
    queueCommand,
    getHealthyPreviewUrl,
  };
}
