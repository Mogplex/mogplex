"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Terminal, type TerminalHandle } from "@wterm/react";
import "@wterm/react/css";
import { useSandboxStore } from "@/hooks/use-sandbox";
import { useTerminalSessionsStore } from "@/hooks/use-terminal-sessions";
import { useTerminalTransport } from "@/hooks/use-terminal-transport";
import { useTerminalExec } from "@/hooks/use-terminal-exec";
import { useTerminalPty } from "@/hooks/use-terminal-pty";
import { useTerminalPortal } from "@/hooks/use-terminal-portal";
import { useTerminalInput } from "@/hooks/use-terminal-input";
import { useTerminalBanner } from "@/hooks/use-terminal-banner";
import {
  getSandboxUiPreviewUrl,
  getSandboxUiRuntimeStatus,
  resolveSandboxUiState,
} from "@/lib/sandbox/ui-state";
import { MOGPLEX_WTERM_STYLE } from "@/lib/terminal/styles";
import { describeExecFallback } from "@/lib/terminal/helpers";
import {
  DevServerDialog,
  type PendingDevServerConfirmation,
} from "@/components/terminal/dev-server-dialog";

type WTermInstance = NonNullable<TerminalHandle["instance"]>;

export function TerminalSession({ paneId }: { paneId: string }) {
  const binding = useTerminalSessionsStore((state) => state.bindings[paneId]);
  const anchor = useTerminalSessionsStore((state) => state.anchors[paneId]);

  const sandboxId = binding?.sandboxId;
  const repoId = binding?.repoId;
  const workingBranch = binding?.workingBranch;
  const terminalSessionKey = binding?.terminalSessionKey ?? paneId;

  const termHandleRef = useRef<TerminalHandle | null>(null);
  const [ready, setReady] = useState(false);
  const [pendingDevServerConfirmation, setPendingDevServerConfirmation] =
    useState<PendingDevServerConfirmation | null>(null);

  const cwdRef = useRef<string | null>(null);
  const prevSandboxIdRef = useRef<string | undefined>(undefined);
  const lastLogLengthRef = useRef(0);
  const shownStartingRef = useRef(false);
  const pendingCommandRef = useRef<string | null>(null);
  const readyRef = useRef(false);
  const pendingDevServerConfirmationRef =
    useRef<PendingDevServerConfirmation | null>(null);

  const sandboxIdRef = useRef(sandboxId);
  const repoIdRef = useRef(repoId);
  const workingBranchRef = useRef(workingBranch);

  const write = useCallback((data: string) => {
    termHandleRef.current?.write(data);
  }, []);

  const writeln = useCallback((data: string) => {
    termHandleRef.current?.write(`${data}\r\n`);
  }, []);

  const logs = useSandboxStore((state) =>
    repoId
      ? state.getLaunchLogs(repoId, { sandboxId, workingBranch })
      : undefined
  );
  const launchCreating = useSandboxStore((state) =>
    repoId ? state.isCreating(repoId, { sandboxId, workingBranch }) : false
  );
  const sandboxStatus = useSandboxStore((state) => {
    if (!repoId) return undefined;
    const sandbox = state.getSandboxForRepo(repoId, { sandboxId, workingBranch });
    const status =
      getSandboxUiRuntimeStatus(
        resolveSandboxUiState({ session: null, record: sandbox })
      ) ?? undefined;
    if (status) return status;
    return launchCreating ? "creating" : undefined;
  });

  const sandboxStatusRef = useRef<string | undefined>(sandboxStatus);
  const transport = useTerminalTransport(
    sandboxStatus === "running" ? sandboxId : undefined,
    terminalSessionKey
  );
  const execFallbackMessage = useMemo(
    () =>
      transport.kind === "exec"
        ? describeExecFallback(transport.reason, transport.detail)
        : null,
    [transport]
  );

  useEffect(() => {
    sandboxIdRef.current = sandboxId;
    repoIdRef.current = repoId;
    workingBranchRef.current = workingBranch;
    sandboxStatusRef.current = sandboxStatus;
  });

  const prompt = useCallback(() => {
    const cwd = cwdRef.current;
    const label = cwd ? cwd.split("/").filter(Boolean).pop() || "/" : "~";
    return `\x1b[37m${label}\x1b[0m > `;
  }, []);

  const writePrompt = useCallback(() => {
    write(prompt());
  }, [prompt, write]);

  // Exec hook
  const { execInSandbox, cancelCurrentRun, currentCmdIdRef } = useTerminalExec(
    { sandboxIdRef, cwdRef },
    { write, writeln, writePrompt }
  );

  // PTY hook
  const { ptyConnected, ptyWsRef, reconnectingForSandboxChangeRef, ptyConnectedRef } =
    useTerminalPty(transport, { write, writeln, writePrompt });

  // Portal hook
  const { portalTarget, portalHost } = useTerminalPortal(anchor, {
    paneId,
    terminalSessionKey,
    sandboxId,
    repoId,
    workingBranch,
  });

  // Banner hook
  const {
    bannerShownRef,
    paintedBannerMessageRef,
    resizeDebounceRef,
    readyFallbackRef,
    appendBannerMessage,
    paintBanner,
  } = useTerminalBanner(execFallbackMessage, { ptyConnectedRef }, { write, writeln, writePrompt });

  const focusTerminal = useCallback(() => {
    termHandleRef.current?.focus();
  }, []);

  const openDevServerConfirmation = useCallback(
    (command: string) => {
      const currentSandboxId = sandboxIdRef.current;
      if (!currentSandboxId) return false;
      const sandbox = useSandboxStore.getState().getSandboxById(currentSandboxId);
      const uiState = resolveSandboxUiState({ session: null, record: sandbox });
      if (uiState.kind !== "live") return false;
      const previewUrl = getSandboxUiPreviewUrl(uiState) ?? null;
      if (!previewUrl) return false;
      const pending = { command, previewUrl } satisfies PendingDevServerConfirmation;
      pendingDevServerConfirmationRef.current = pending;
      setPendingDevServerConfirmation(pending);
      return true;
    },
    []
  );

  const clearDevServerConfirmation = useCallback(() => {
    pendingDevServerConfirmationRef.current = null;
    setPendingDevServerConfirmation(null);
  }, []);

  const cancelDevServerConfirmation = useCallback(() => {
    clearDevServerConfirmation();
    writePrompt();
    focusTerminal();
  }, [clearDevServerConfirmation, focusTerminal, writePrompt]);

  const confirmDevServerCommand = useCallback(() => {
    const pending = pendingDevServerConfirmationRef.current;
    if (!pending) return;
    clearDevServerConfirmation();
    void execInSandbox(pending.command);
    focusTerminal();
  }, [clearDevServerConfirmation, execInSandbox, focusTerminal]);

  // Input hook
  const { handleLocalInput, inputBuffer } = useTerminalInput(
    {
      sandboxIdRef,
      repoIdRef,
      workingBranchRef,
      sandboxStatusRef,
      currentCmdIdRef,
      pendingCommandRef,
    },
    {
      write,
      writeln,
      writePrompt,
      execInSandbox,
      cancelCurrentRun,
      openDevServerConfirmation,
    }
  );

  const handleData = useCallback(
    (data: string) => {
      const ws = ptyWsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(new TextEncoder().encode(data));
        return;
      }
      if (pendingDevServerConfirmationRef.current) return;
      handleLocalInput(data);
    },
    [handleLocalInput, ptyWsRef]
  );

  // Resize handling
  const shouldStickToBottomRef = useRef(true);
  const resizeScrollFrameRef = useRef<number | null>(null);
  const terminalScrollCleanupRef = useRef<(() => void) | null>(null);

  const keepTerminalAtBottomAfterResize = useCallback(() => {
    if (resizeScrollFrameRef.current !== null) {
      cancelAnimationFrame(resizeScrollFrameRef.current);
    }
    resizeScrollFrameRef.current = requestAnimationFrame(() => {
      resizeScrollFrameRef.current = requestAnimationFrame(() => {
        const element = termHandleRef.current?.instance?.element;
        if (element) {
          element.scrollTop = element.scrollHeight;
        }
        resizeScrollFrameRef.current = null;
      });
    });
  }, []);

  const handleReady = useCallback(
    (terminal: WTermInstance) => {
      terminalScrollCleanupRef.current?.();
      const element = terminal.element;
      const updateStickToBottom = () => {
        shouldStickToBottomRef.current =
          element.scrollHeight - element.scrollTop - element.clientHeight < 5;
      };
      updateStickToBottom();
      element.addEventListener("scroll", updateStickToBottom, { passive: true });
      terminalScrollCleanupRef.current = () =>
        element.removeEventListener("scroll", updateStickToBottom);

      setReady(true);
      readyRef.current = true;
      readyFallbackRef.current = setTimeout(() => {
        paintBanner();
      }, 600);
    },
    [paintBanner, readyFallbackRef]
  );

  useEffect(
    () => () => {
      terminalScrollCleanupRef.current?.();
      if (resizeScrollFrameRef.current !== null) {
        cancelAnimationFrame(resizeScrollFrameRef.current);
      }
    },
    []
  );

  useEffect(() => {
    if (!execFallbackMessage || ptyConnected) return;
    if (!bannerShownRef.current) return;
    if (paintedBannerMessageRef.current === execFallbackMessage) return;
    if (inputBuffer.current.length > 0 || currentCmdIdRef.current) return;
    appendBannerMessage(execFallbackMessage);
  }, [
    appendBannerMessage,
    bannerShownRef,
    currentCmdIdRef,
    execFallbackMessage,
    inputBuffer,
    paintedBannerMessageRef,
    ptyConnected,
  ]);

  const handleResize = useCallback(
    (cols?: number, rows?: number) => {
      const ws = ptyWsRef.current;
      if (
        ws &&
        ws.readyState === WebSocket.OPEN &&
        typeof cols === "number" &&
        typeof rows === "number"
      ) {
        try {
          ws.send(JSON.stringify({ type: "resize", cols, rows }));
        } catch {
          /* send on closing socket */
        }
      }
      if (shouldStickToBottomRef.current) {
        keepTerminalAtBottomAfterResize();
      }
      if (ptyConnectedRef.current) return;
      if (!readyRef.current || bannerShownRef.current) return;
      if (resizeDebounceRef.current) clearTimeout(resizeDebounceRef.current);
      resizeDebounceRef.current = setTimeout(() => {
        resizeDebounceRef.current = null;
        paintBanner();
      }, 100);
    },
    [
      bannerShownRef,
      keepTerminalAtBottomAfterResize,
      paintBanner,
      ptyConnectedRef,
      ptyWsRef,
      resizeDebounceRef,
    ]
  );

  useEffect(() => {
    if (prevSandboxIdRef.current === sandboxId) return;
    const hadSandbox = Boolean(prevSandboxIdRef.current);
    prevSandboxIdRef.current = sandboxId;
    cwdRef.current = null;
    lastLogLengthRef.current = 0;
    clearDevServerConfirmation();

    if (hadSandbox && termHandleRef.current) {
      reconnectingForSandboxChangeRef.current = Boolean(sandboxId);
      writeln(
        sandboxId
          ? "\x1b[33m▸ Sandbox restarted. Reconnecting terminal session...\x1b[0m"
          : "\x1b[90mSwitched sandbox context\x1b[0m"
      );
    }
  }, [clearDevServerConfirmation, reconnectingForSandboxChangeRef, sandboxId, writeln]);

  useEffect(() => {
    lastLogLengthRef.current = 0;
    cwdRef.current = null;
    shownStartingRef.current = false;
  }, [repoId, workingBranch]);

  useEffect(() => {
    if (logs !== undefined && logs.length === 0) {
      shownStartingRef.current = false;
      lastLogLengthRef.current = 0;
    }
  }, [logs]);

  useEffect(() => {
    if (!ready || !repoId || logs === undefined) return;

    if (!shownStartingRef.current && logs.length > 0) {
      shownStartingRef.current = true;
      writeln("\x1b[33m▸ Starting sandbox...\x1b[0m");
    }

    if (logs.length > lastLogLengthRef.current) {
      const delta = logs.slice(lastLogLengthRef.current);
      write(delta.replace(/\n/g, "\r\n"));
      lastLogLengthRef.current = logs.length;
    }
  }, [logs, ready, repoId, write, writeln]);

  useEffect(() => {
    if (!ready || !sandboxId || sandboxStatus !== "running") return;
    const pending = pendingCommandRef.current;
    if (!pending) return;
    pendingCommandRef.current = null;
    void execInSandbox(pending);
  }, [execInSandbox, ready, sandboxId, sandboxStatus]);

  if (!portalTarget || !portalHost) return null;

  return createPortal(
    <>
      <div className="relative h-full w-full">
        <Terminal
          ref={termHandleRef}
          autoResize
          cursorBlink
          onData={handleData}
          onReady={handleReady}
          onResize={handleResize}
          style={MOGPLEX_WTERM_STYLE}
        />
      </div>
      <DevServerDialog
        pending={pendingDevServerConfirmation}
        onCancel={cancelDevServerConfirmation}
        onConfirm={confirmDevServerCommand}
      />
    </>,
    portalHost
  );
}
