"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { Terminal, type TerminalHandle } from "@wterm/react";
import "@wterm/react/css";
import { useSandboxStore } from "@/hooks/use-sandbox";
import { useSessionsStore } from "@/hooks/use-sessions";
import { useTerminalSessionsStore } from "@/hooks/use-terminal-sessions";
import { getActiveTeamRequestHeaders } from "@/components/active-scope-provider";
import {
  useTerminalTransport,
  type TerminalExecFallbackReason,
} from "@/hooks/use-terminal-transport";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { shouldWarnAboutDevServerCommand } from "@/lib/sandbox/dev-server-guard";
import { readTerminalExecImmediateResponse } from "@/lib/sandbox/terminal-exec-response";
import {
  bindSessionToPendingSandboxBranch,
  ensureSessionSandboxBinding,
} from "@/lib/sandbox/session-retarget";
import { resolveTerminalPortalTarget } from "@/lib/terminal-portal-target";
import {
  getSandboxUiPreviewUrl,
  getSandboxUiRuntimeStatus,
  resolveSandboxUiState,
} from "@/lib/sandbox/ui-state";

const commandHistory: string[] = [];
const MAX_HISTORY = 200;
type WTermInstance = NonNullable<TerminalHandle["instance"]>;

const MOGPLEX_WTERM_STYLE = {
  height: "100%",
  width: "100%",
  borderRadius: 0,
  boxShadow: "none",
  padding: "12px",
  // wterm scrolls scrollback via native overflow on the .wterm element (it has
  // no internal wheel handler). scrollbar-gutter:stable reserves the 4px gutter
  // so autoResize's column count doesn't jitter when .has-scrollback toggles.
  scrollbarGutter: "stable",
  "--term-bg": "var(--terminal-background)",
  "--term-fg": "var(--terminal-foreground)",
  "--term-cursor": "var(--terminal-cursor)",
  "--term-font-family":
    "Geist Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  "--term-font-size": "13px",
  "--term-color-0": "var(--terminal-background)",
  "--term-color-1": "var(--accent-red)",
  "--term-color-2": "var(--accent-green)",
  "--term-color-3": "var(--accent-amber)",
  "--term-color-4": "var(--accent-blue)",
  "--term-color-5": "var(--accent-violet)",
  "--term-color-6": "var(--accent-cyan)",
  "--term-color-7": "var(--terminal-foreground)",
  "--term-color-8": "var(--terminal-muted)",
  "--term-color-9": "var(--accent-red)",
  "--term-color-10": "var(--accent-green)",
  "--term-color-11": "var(--accent-amber)",
  "--term-color-12": "var(--accent-blue)",
  "--term-color-13": "var(--accent-violet)",
  "--term-color-14": "var(--accent-cyan)",
  "--term-color-15": "var(--terminal-cursor)",
} as CSSProperties;

type PendingDevServerConfirmation = {
  command: string;
  previewUrl: string;
};

// Sessions rendered by TerminalHost survive pane remounts, but when no pane
// currently mounts a terminal we still need a valid DOM target for createPortal
// to avoid React warnings. The fallback retains the pane's last dimensions so
// wterm's auto-resize does not collapse its grid and destroy the visible buffer.
function createFallbackContainer(paneId: string) {
  const fallback = document.createElement("div");
  fallback.setAttribute("data-terminal-session-fallback", paneId);
  fallback.style.cssText =
    "position:fixed;left:-100000px;top:0;width:1px;height:1px;overflow:hidden;pointer-events:none;visibility:hidden;";
  return fallback;
}

function describeExecFallback(
  reason: TerminalExecFallbackReason | undefined,
  detail: string | undefined
) {
  const normalizedDetail =
    typeof detail === "string" && detail.trim().length > 0
      ? detail.trim()
      : undefined;

  switch (reason) {
    case "pty_disabled":
      return "PTY disabled; using exec fallback.";
    case "bridge_not_ready":
      return "PTY not ready yet; using exec fallback.";
    case "tmux_unavailable":
      return normalizedDetail
        ? `PTY unavailable: ${normalizedDetail}.`
        : "PTY unavailable because tmux could not be prepared.";
    case "bridge_install_failed":
      return normalizedDetail
        ? `PTY unavailable: ${normalizedDetail}.`
        : "PTY unavailable because the terminal bridge failed to install.";
    case "bridge_unreachable":
      return normalizedDetail
        ? `PTY unavailable: ${normalizedDetail}.`
        : "PTY unavailable because the terminal bridge could not be reached.";
    case "http_error":
      return normalizedDetail
        ? `PTY setup failed: ${normalizedDetail}.`
        : "PTY setup failed; using exec fallback.";
    case "connect_failed":
      return normalizedDetail
        ? `PTY setup failed: ${normalizedDetail}.`
        : "PTY setup failed; using exec fallback.";
    default:
      return normalizedDetail ?? null;
  }
}

export function TerminalSession({ paneId }: { paneId: string }) {
  const binding = useTerminalSessionsStore((state) => state.bindings[paneId]);
  const anchor = useTerminalSessionsStore((state) => state.anchors[paneId]);

  const sandboxId = binding?.sandboxId;
  const repoId = binding?.repoId;
  const workingBranch = binding?.workingBranch;
  const terminalSessionKey = binding?.terminalSessionKey ?? paneId;

  const activeSessionId = useSessionsStore((state) => state.activeSessionId);
  const termHandleRef = useRef<TerminalHandle | null>(null);
  const [ready, setReady] = useState(false);
  const [pendingDevServerConfirmation, setPendingDevServerConfirmation] =
    useState<PendingDevServerConfirmation | null>(null);

  const inputBuffer = useRef("");
  const historyIdx = useRef(-1);
  const cwdRef = useRef<string | null>(null);
  const prevSandboxIdRef = useRef<string | undefined>(undefined);
  const lastLogLengthRef = useRef(0);
  const shownStartingRef = useRef(false);
  const pendingCommandRef = useRef<string | null>(null);
  const bannerShownRef = useRef(false);
  const readyRef = useRef(false);
  const currentCmdIdRef = useRef<string | null>(null);
  const currentRunAbortRef = useRef<AbortController | null>(null);
  const ptyWsRef = useRef<WebSocket | null>(null);
  const reconnectingForSandboxChangeRef = useRef(false);
  const ptyConnectedRef = useRef(false);
  const paintedBannerMessageRef = useRef<string | null>(null);
  const [ptyConnected, setPtyConnected] = useState(false);
  const [fallbackContainer, setFallbackContainer] =
    useState<HTMLDivElement | null>(null);
  const portalHostRef = useRef<HTMLDivElement | null>(null);

  if (!portalHostRef.current && typeof document !== "undefined") {
    const host = document.createElement("div");
    host.setAttribute("data-terminal-session-host", paneId);
    host.style.cssText = "height:100%;width:100%;";
    portalHostRef.current = host;
  }

  const sandboxIdRef = useRef(sandboxId);
  const repoIdRef = useRef(repoId);
  const workingBranchRef = useRef(workingBranch);

  const pendingDevServerConfirmationRef =
    useRef<PendingDevServerConfirmation | null>(null);

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
    const sandbox = state.getSandboxForRepo(repoId, {
      sandboxId,
      workingBranch,
    });
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

  const execInSandbox = useCallback(
    async (command: string) => {
      const sid = sandboxIdRef.current;
      if (!sid) return;

      write("\r\n");

      const controller = new AbortController();
      currentRunAbortRef.current = controller;
      currentCmdIdRef.current = null;

      try {
        const res = await fetch(`/api/sandbox/${sid}/exec`, {
          method: "POST",
          headers: getActiveTeamRequestHeaders({
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          }),
          body: JSON.stringify({ command, cwd: cwdRef.current }),
          signal: controller.signal,
        });

        const immediate = await readTerminalExecImmediateResponse(res);
        if (immediate) {
          if (immediate.cwd) {
            cwdRef.current = immediate.cwd;
          }
          if (immediate.stdout) {
            write(immediate.stdout.replace(/\n/g, "\r\n"));
          }
          if (immediate.stderr) {
            write(`\x1b[31m${immediate.stderr.replace(/\n/g, "\r\n")}\x1b[0m`);
          }
          if (immediate.error) {
            writeln(`\x1b[31m${immediate.error}\x1b[0m`);
          }
          return;
        }

        if (!res.ok || !res.body) {
          writeln(`\x1b[31mexec failed (${res.status})\x1b[0m`);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let boundary = buffer.indexOf("\n\n");
          while (boundary !== -1) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            boundary = buffer.indexOf("\n\n");

            if (!frame.startsWith("data: ")) continue;
            const payload = frame.slice(6);
            let event: {
              type: string;
              stream?: "stdout" | "stderr";
              data?: string;
              cmdId?: string;
              exitCode?: number | null;
              cwd?: string;
            };
            try {
              event = JSON.parse(payload);
            } catch {
              continue;
            }

            if (event.type === "run" && event.cmdId) {
              currentCmdIdRef.current = event.cmdId;
            } else if (event.type === "log" && event.data) {
              const text = event.data.replace(/\n/g, "\r\n");
              if (event.stream === "stderr") {
                write(`\x1b[31m${text}\x1b[0m`);
              } else {
                write(text);
              }
            } else if (event.type === "done") {
              if (event.cwd) cwdRef.current = event.cwd;
            } else if (event.type === "cancelled") {
              writeln("\r\n\x1b[33m^C\x1b[0m");
            } else if (event.type === "error" && event.data) {
              writeln(`\x1b[31m${event.data}\x1b[0m`);
            }
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          writeln("\r\n\x1b[33m^C\x1b[0m");
        } else {
          writeln("\x1b[31mExecution failed\x1b[0m");
        }
      } finally {
        currentCmdIdRef.current = null;
        currentRunAbortRef.current = null;
        writePrompt();
      }
    },
    [write, writeln, writePrompt]
  );

  const cancelCurrentRun = useCallback(async () => {
    const cmdId = currentCmdIdRef.current;
    const sid = sandboxIdRef.current;
    if (!cmdId || !sid) return false;
    try {
      await fetch(`/api/sandbox/${sid}/exec/cancel`, {
        method: "POST",
        headers: getActiveTeamRequestHeaders({
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ cmdId }),
      });
      return true;
    } catch {
      return false;
    }
  }, []);

  const queueCommand = useCallback((command: string) => {
    pendingCommandRef.current = command;
  }, []);

  const focusTerminal = useCallback(() => {
    termHandleRef.current?.focus();
  }, []);

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

  const getHealthyPreviewUrl = useCallback(() => {
    const currentSandboxId = sandboxIdRef.current;
    if (!currentSandboxId) return null;
    const sandbox = useSandboxStore.getState().getSandboxById(currentSandboxId);
    const uiState = resolveSandboxUiState({ session: null, record: sandbox });
    if (uiState.kind !== "live") return null;
    return getSandboxUiPreviewUrl(uiState) ?? null;
  }, []);

  const openDevServerConfirmation = useCallback(
    (command: string) => {
      const previewUrl = getHealthyPreviewUrl();
      if (!previewUrl) return false;
      const pending = {
        command,
        previewUrl,
      } satisfies PendingDevServerConfirmation;
      pendingDevServerConfirmationRef.current = pending;
      setPendingDevServerConfirmation(pending);
      return true;
    },
    [getHealthyPreviewUrl]
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
          shouldWarnAboutDevServerCommand(command, previewUrl, "running")
        ) {
          if (openDevServerConfirmation(command)) {
            write("\r\n");
            return;
          }
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
            "\x1b[33m▸ Sandbox is still starting. Command queued...\x1b[0m"
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
          writeln("\x1b[33m▸ Restarting sandbox to run command...\x1b[0m");
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
          writeln("\x1b[33m▸ Starting sandbox to run command...\x1b[0m");
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
        writeln("\x1b[90mNo repo selected\x1b[0m");
        writePrompt();
        return;
      }

      if (data === "\x1b[A") {
        if (historyIdx.current < commandHistory.length - 1) {
          historyIdx.current += 1;
          replaceInput(commandHistory[historyIdx.current]);
        }
        return;
      }

      if (data === "\x1b[B") {
        if (historyIdx.current > 0) {
          historyIdx.current -= 1;
          replaceInput(commandHistory[historyIdx.current]);
        } else if (historyIdx.current === 0) {
          historyIdx.current = -1;
          replaceInput("");
        }
        return;
      }

      if (data === "\x7f") {
        if (inputBuffer.current.length > 0) {
          inputBuffer.current = inputBuffer.current.slice(0, -1);
          write("\b \b");
        }
        return;
      }

      if (data === "\x03") {
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
      execInSandbox,
      getHealthyPreviewUrl,
      openDevServerConfirmation,
      queueCommand,
      replaceInput,
      write,
      writeln,
      writePrompt,
    ]
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
    [handleLocalInput]
  );

  // Open a WebSocket to the in-sandbox bridge when transport reports pty. On
  // open, clear the exec-mode banner and let bash paint its own prompt. On
  // close or error, fall back to the Phase 2a exec path without user action.
  useEffect(() => {
    if (transport.kind !== "pty") {
      reconnectingForSandboxChangeRef.current = false;
      setPtyConnected(false);
      if (ptyWsRef.current) {
        try {
          ptyWsRef.current.close();
        } catch {
          /* already closing */
        }
        ptyWsRef.current = null;
      }
      return;
    }
    const ws = new WebSocket(transport.wsUrl);
    ws.binaryType = "arraybuffer";
    ptyWsRef.current = ws;
    const decoder = new TextDecoder("utf-8", { fatal: false });

    ws.onopen = () => {
      reconnectingForSandboxChangeRef.current = false;
      setPtyConnected(true);
      write("\x1b[1;1H\x1b[2J\x1b[3J");
    };
    ws.onmessage = (event) => {
      if (typeof event.data === "string") return;
      const bytes = new Uint8Array(event.data as ArrayBuffer);
      write(decoder.decode(bytes, { stream: true }));
    };
    ws.onclose = () => {
      if (ptyWsRef.current === ws) {
        ptyWsRef.current = null;
        setPtyConnected(false);
        if (reconnectingForSandboxChangeRef.current) {
          return;
        }
        writeln("\r\n\x1b[33m[pty disconnected — falling back to exec mode]\x1b[0m");
        writePrompt();
      }
    };
    ws.onerror = () => {
      // onclose fires separately; keep the fallback logic in one place.
    };

    return () => {
      if (ptyWsRef.current === ws) ptyWsRef.current = null;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    };
  }, [transport, write, writeln, writePrompt]);

  const resizeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readyFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const resizeScrollFrameRef = useRef<number | null>(null);
  const terminalScrollCleanupRef = useRef<(() => void) | null>(null);

  const keepTerminalAtBottomAfterResize = useCallback(() => {
    if (resizeScrollFrameRef.current !== null) {
      cancelAnimationFrame(resizeScrollFrameRef.current);
    }
    // wterm rebuilds its grid on a deferred render. The second frame restores
    // scroll only after that rebuild has had a frame to reset the DOM offset.
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

  const renderBanner = useCallback(
    (message: string | null) => {
      paintedBannerMessageRef.current = message;
      write("\x1b[1;1H\x1b[2J\x1b[3J\x1b[1;1H");
      writeln("\x1b[37mMogplex\x1b[0m Terminal Ready");
      if (message) {
        writeln(`\x1b[90m${message}\x1b[0m`);
      }
      writePrompt();
    },
    [write, writeln, writePrompt]
  );

  const appendBannerMessage = useCallback(
    (message: string) => {
      paintedBannerMessageRef.current = message;
      write("\r\n");
      writeln(`\x1b[90m${message}\x1b[0m`);
      writePrompt();
    },
    [write, writeln, writePrompt]
  );

  const paintBanner = useCallback(() => {
    if (bannerShownRef.current || ptyConnectedRef.current) return;
    bannerShownRef.current = true;
    if (resizeDebounceRef.current) {
      clearTimeout(resizeDebounceRef.current);
      resizeDebounceRef.current = null;
    }
    if (readyFallbackRef.current) {
      clearTimeout(readyFallbackRef.current);
      readyFallbackRef.current = null;
    }
    renderBanner(execFallbackMessage);
  }, [execFallbackMessage, renderBanner]);

  const handleReady = useCallback(
    (terminal: WTermInstance) => {
      terminalScrollCleanupRef.current?.();
      const element = terminal.element;
      const updateStickToBottom = () => {
        shouldStickToBottomRef.current =
          element.scrollHeight - element.scrollTop - element.clientHeight < 5;
      };
      updateStickToBottom();
      element.addEventListener("scroll", updateStickToBottom, {
        passive: true,
      });
      terminalScrollCleanupRef.current = () =>
        element.removeEventListener("scroll", updateStickToBottom);

      setReady(true);
      readyRef.current = true;
      readyFallbackRef.current = setTimeout(() => {
        paintBanner();
      }, 600);
    },
    [paintBanner]
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
    ptyConnectedRef.current = ptyConnected;
  }, [ptyConnected]);

  useEffect(() => {
    if (!execFallbackMessage || ptyConnected) return;
    if (!bannerShownRef.current) return;
    if (paintedBannerMessageRef.current === execFallbackMessage) return;
    if (inputBuffer.current.length > 0 || currentCmdIdRef.current) return;
    appendBannerMessage(execFallbackMessage);
  }, [appendBannerMessage, execFallbackMessage, ptyConnected]);

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
    [keepTerminalAtBottomAfterResize, paintBanner]
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
  }, [clearDevServerConfirmation, sandboxId, writeln]);

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

  // When XTermPane remounts (e.g. root-pane split restructures the tree), anchor
  // briefly becomes null before the new div registers. Using the last non-null
  // anchor avoids an unnecessary fallback handoff while React replaces the div.
  const lastAnchorRef = useRef<HTMLElement | null>(null);
  const lastAnchorSizeRef = useRef<{ width: number; height: number } | null>(
    null
  );
  const hasConnectedAnchorRef = useRef(false);
  const lastPortalBindingKeyRef = useRef<string | null>(null);
  const portalBindingKey = `${paneId}:${terminalSessionKey}:${sandboxId ?? ""}:${repoId ?? ""}:${workingBranch ?? ""}`;
  if (lastPortalBindingKeyRef.current !== portalBindingKey) {
    lastPortalBindingKeyRef.current = portalBindingKey;
    lastAnchorRef.current = anchor?.isConnected ? anchor : null;
    hasConnectedAnchorRef.current = Boolean(anchor?.isConnected);
  }
  if (anchor?.isConnected) {
    lastAnchorRef.current = anchor;
    hasConnectedAnchorRef.current = true;
  }

  useLayoutEffect(() => {
    const fallback = createFallbackContainer(paneId);
    document.body.appendChild(fallback);
    setFallbackContainer(fallback);
    return () => fallback.remove();
  }, [paneId]);

  useLayoutEffect(() => {
    if (!anchor?.isConnected) return;
    const rememberAnchorSize = () => {
      if (!anchor.isConnected) return;
      const width = anchor.clientWidth;
      const height = anchor.clientHeight;
      if (width > 0 && height > 0) {
        lastAnchorSizeRef.current = { width, height };
        if (fallbackContainer) {
          fallbackContainer.style.width = `${width}px`;
          fallbackContainer.style.height = `${height}px`;
        }
      }
    };
    rememberAnchorSize();
    const observer = new ResizeObserver(rememberAnchorSize);
    observer.observe(anchor);
    return () => observer.disconnect();
  }, [anchor, fallbackContainer]);

  const portalTarget = useMemo(
    () => {
      if (!hasConnectedAnchorRef.current && !anchor?.isConnected) {
        return null;
      }

      return resolveTerminalPortalTarget({
        anchor,
        lastAnchor: lastAnchorRef.current,
        fallback: fallbackContainer,
      });
    },
    [anchor, fallbackContainer]
  );

  useLayoutEffect(() => {
    const host = portalHostRef.current;
    if (!host || !portalTarget) return;
    if (host.parentElement === portalTarget) return;
    portalTarget.appendChild(host);
  }, [portalTarget]);

  useEffect(() => {
    return () => {
      lastAnchorRef.current = null;
      lastAnchorSizeRef.current = null;
      hasConnectedAnchorRef.current = false;
      lastPortalBindingKeyRef.current = null;
      const host = portalHostRef.current;
      if (host?.parentElement) {
        host.parentElement.removeChild(host);
      }
    };
  }, [paneId]);

  const portalHost = portalHostRef.current;

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
      <AlertDialog
        open={pendingDevServerConfirmation !== null}
        onOpenChange={(open) => {
          if (!open) cancelDevServerConfirmation();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Dev server already running</AlertDialogTitle>
            <AlertDialogDescription>
              Mogplex already sees a healthy preview at{" "}
              <span className="text-foreground font-mono">
                {pendingDevServerConfirmation?.previewUrl}
              </span>
              . Starting another dev server may conflict on port 3000.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelDevServerConfirmation}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmDevServerCommand}>
              Run anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>,
    portalHost
  );
}
