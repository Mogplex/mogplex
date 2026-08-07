"use client";

import { useEffect, useRef, useState } from "react";
import type { TerminalTransportInfo } from "@/hooks/use-terminal-transport";
import { ANSI } from "@/lib/terminal/styles";

type PtyCallbacks = {
  write: (data: string) => void;
  writeln: (data: string) => void;
  writePrompt: () => void;
};

/**
 * Manages the PTY WebSocket connection for a terminal session.
 * Opens a WebSocket to the in-sandbox bridge when transport reports pty. On
 * open, clears the exec-mode banner and lets bash paint its own prompt. On
 * close or error, falls back to the Phase 2a exec path without user action.
 */
export function useTerminalPty(
  transport: TerminalTransportInfo,
  callbacks: PtyCallbacks
) {
  const { write, writeln, writePrompt } = callbacks;
  const [ptyConnected, setPtyConnected] = useState(false);
  const ptyWsRef = useRef<WebSocket | null>(null);
  const reconnectingForSandboxChangeRef = useRef(false);
  const ptyConnectedRef = useRef(false);

  useEffect(() => {
    ptyConnectedRef.current = ptyConnected;
  }, [ptyConnected]);

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

    const handleOpen = () => {
      reconnectingForSandboxChangeRef.current = false;
      setPtyConnected(true);
      write(ANSI.CLEAR_SCREEN);
    };

    const handleMessage = (event: MessageEvent) => {
      if (typeof event.data === "string") return;
      const bytes = new Uint8Array(event.data as ArrayBuffer);
      write(decoder.decode(bytes, { stream: true }));
    };

    const handleClose = () => {
      if (ptyWsRef.current === ws) {
        ptyWsRef.current = null;
        setPtyConnected(false);
        if (reconnectingForSandboxChangeRef.current) {
          return;
        }
        writeln(
          `\r\n${ANSI.YELLOW}[pty disconnected — falling back to exec mode]${ANSI.RESET}`
        );
        writePrompt();
      }
    };

    const handleError = () => {
      // onclose fires separately; keep the fallback logic in one place.
    };

    ws.addEventListener("open", handleOpen);
    ws.addEventListener("message", handleMessage);
    ws.addEventListener("close", handleClose);
    ws.addEventListener("error", handleError);

    return () => {
      ws.removeEventListener("open", handleOpen);
      ws.removeEventListener("message", handleMessage);
      ws.removeEventListener("close", handleClose);
      ws.removeEventListener("error", handleError);
      if (ptyWsRef.current === ws) ptyWsRef.current = null;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    };
  }, [transport, write, writeln, writePrompt]);

  return {
    ptyConnected,
    ptyWsRef,
    reconnectingForSandboxChangeRef,
    ptyConnectedRef,
  };
}
