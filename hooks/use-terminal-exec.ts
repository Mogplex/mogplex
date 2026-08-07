"use client";

import { useCallback, useRef } from "react";
import { getActiveTeamRequestHeaders } from "@/components/active-scope-provider";
import { readTerminalExecImmediateResponse } from "@/lib/sandbox/terminal-exec-response";
import { ANSI } from "@/lib/terminal/styles";

type ExecRefs = {
  sandboxIdRef: React.RefObject<string | undefined>;
  cwdRef: React.MutableRefObject<string | null>;
};

type WriteCallbacks = {
  write: (data: string) => void;
  writeln: (data: string) => void;
  writePrompt: () => void;
};

export function useTerminalExec(refs: ExecRefs, callbacks: WriteCallbacks) {
  const { sandboxIdRef, cwdRef } = refs;
  const { write, writeln, writePrompt } = callbacks;

  const currentCmdIdRef = useRef<string | null>(null);
  const currentRunAbortRef = useRef<AbortController | null>(null);

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
            write(
              `${ANSI.RED}${immediate.stderr.replace(/\n/g, "\r\n")}${ANSI.RESET}`
            );
          }
          if (immediate.error) {
            writeln(`${ANSI.RED}${immediate.error}${ANSI.RESET}`);
          }
          return;
        }

        if (!res.ok || !res.body) {
          writeln(`${ANSI.RED}exec failed (${res.status})${ANSI.RESET}`);
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
                write(`${ANSI.RED}${text}${ANSI.RESET}`);
              } else {
                write(text);
              }
            } else if (event.type === "done") {
              if (event.cwd) cwdRef.current = event.cwd;
            } else if (event.type === "cancelled") {
              writeln(`\r\n${ANSI.YELLOW}^C${ANSI.RESET}`);
            } else if (event.type === "error" && event.data) {
              writeln(`${ANSI.RED}${event.data}${ANSI.RESET}`);
            }
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          writeln(`\r\n${ANSI.YELLOW}^C${ANSI.RESET}`);
        } else {
          writeln(`${ANSI.RED}Execution failed${ANSI.RESET}`);
        }
      } finally {
        currentCmdIdRef.current = null;
        currentRunAbortRef.current = null;
        writePrompt();
      }
    },
    [sandboxIdRef, cwdRef, write, writeln, writePrompt]
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
  }, [sandboxIdRef]);

  return {
    execInSandbox,
    cancelCurrentRun,
    currentCmdIdRef,
    currentRunAbortRef,
  };
}
