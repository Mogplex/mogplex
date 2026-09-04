import { describe, expect, it } from "vitest";
import type { Command } from "@vercel/sandbox";
import {
  isResumableCommandStreamError,
  streamCommandLogsWithResume,
} from "./command-stream";

type Line = { stream: "stdout" | "stderr"; data: string };

/**
 * Builds a fake detached Command whose logs() yields the given batches in
 * order, one batch per connection. A batch may end with a thrown error to
 * simulate the sandbox API capping or dropping the streaming request. Every
 * connection replays the command's whole output from the start, matching the
 * real ndjson logs endpoint for a detached command.
 */
function makeCommand(
  connections: Array<{ upto: number; throwError?: unknown }>,
  allLines: Line[]
): { command: Command; connectionCount: () => number } {
  let connection = 0;
  const command = {
    cmdId: "cmd_test",
    logs() {
      const plan = connections[Math.min(connection, connections.length - 1)];
      connection += 1;
      const replay = allLines.slice(0, plan.upto);
      async function* gen() {
        for (const line of replay) yield line;
        if (plan.throwError) throw plan.throwError as Error;
      }
      return gen();
    },
  } as unknown as Command;
  return { command, connectionCount: () => connection };
}

describe("isResumableCommandStreamError", () => {
  it("should treat a capped or dropped sandbox request as resumable", () => {
    expect(
      isResumableCommandStreamError(new Error("Status code 400 is not ok"))
    ).toBe(true);
    expect(isResumableCommandStreamError(new Error("terminated"))).toBe(true);
    expect(isResumableCommandStreamError(new Error("socket hang up"))).toBe(
      true
    );
  });

  it("should not treat an ordinary application error as resumable", () => {
    expect(
      isResumableCommandStreamError(new Error("prompt was rejected"))
    ).toBe(false);
    expect(isResumableCommandStreamError(null)).toBe(false);
  });
});

describe("streamCommandLogsWithResume", () => {
  it("should reconnect after a capped stream and emit each log line once", async () => {
    const allLines: Line[] = [
      { stream: "stdout", data: "a" },
      { stream: "stdout", data: "b" },
      { stream: "stderr", data: "c" },
      { stream: "stdout", data: "d" },
      { stream: "stdout", data: "e" },
    ];
    // First connection streams 3 lines then the request is capped with a 400;
    // second connection replays all 5 and ends cleanly.
    const { command, connectionCount } = makeCommand(
      [
        { upto: 3, throwError: new Error("Status code 400 is not ok") },
        { upto: 5 },
      ],
      allLines
    );

    const seen: Line[] = [];
    let exitCodeReads = 0;
    const reconnects: number[] = [];

    const exitCode = await streamCommandLogsWithResume(
      {
        command,
        onLog: (log) => {
          seen.push(log);
        },
        onReconnect: ({ attempt }) => {
          reconnects.push(attempt);
        },
        reconnectDelayMs: 0,
      },
      {
        getExitCode: async () => {
          exitCodeReads += 1;
          // Still running right after the capped request, finished after replay.
          return exitCodeReads === 1 ? null : 0;
        },
        delay: async () => {},
      }
    );

    expect(exitCode).toBe(0);
    expect(seen).toEqual(allLines);
    expect(connectionCount()).toBe(2);
    expect(reconnects).toEqual([1]);
  });

  it("should return the exit code without reconnecting when the stream ends cleanly", async () => {
    const allLines: Line[] = [{ stream: "stdout", data: "only" }];
    const { command, connectionCount } = makeCommand([{ upto: 1 }], allLines);
    const seen: Line[] = [];

    const exitCode = await streamCommandLogsWithResume(
      {
        command,
        onLog: (log) => {
          seen.push(log);
        },
        reconnectDelayMs: 0,
      },
      { getExitCode: async () => 0, delay: async () => {} }
    );

    expect(exitCode).toBe(0);
    expect(seen).toEqual(allLines);
    expect(connectionCount()).toBe(1);
  });

  it("should rethrow an error the command stream cannot resume from", async () => {
    const fatal = new Error("prompt was rejected");
    const { command } = makeCommand([{ upto: 0, throwError: fatal }], []);

    await expect(
      streamCommandLogsWithResume(
        { command, onLog: () => {}, reconnectDelayMs: 0 },
        { getExitCode: async () => null, delay: async () => {} }
      )
    ).rejects.toThrow("prompt was rejected");
  });

  it("should keep polling a long-running command until it finishes, past the cap", async () => {
    const allLines: Line[] = [
      { stream: "stdout", data: "start" },
      { stream: "stdout", data: "mid" },
      { stream: "stdout", data: "end" },
    ];
    // The live stream caps after one line; the command keeps running through
    // several polls before it finally exits, each poll snapshot adding output.
    const { command, connectionCount } = makeCommand(
      [
        { upto: 1, throwError: new Error("Status code 400 is not ok") },
        { upto: 1 },
        { upto: 2 },
        { upto: 3 },
      ],
      allLines
    );
    const seen: Line[] = [];
    let reads = 0;

    const exitCode = await streamCommandLogsWithResume(
      {
        command,
        onLog: (log) => {
          seen.push(log);
        },
        reconnectDelayMs: 0,
      },
      {
        getExitCode: async () => {
          reads += 1;
          return reads >= 4 ? 0 : null;
        },
        delay: async () => {},
      }
    );

    expect(exitCode).toBe(0);
    expect(seen).toEqual(allLines);
    expect(connectionCount()).toBe(4);
  });

  it("should fail a still-running command once the wall-clock deadline passes", async () => {
    const capped = new Error("Status code 400 is not ok");
    const { command } = makeCommand([{ upto: 0, throwError: capped }], []);
    let clock = 0;

    await expect(
      streamCommandLogsWithResume(
        {
          command,
          onLog: () => {},
          deadlineMs: 1_000,
          reconnectDelayMs: 0,
        },
        {
          getExitCode: async () => null,
          delay: async () => {},
          now: () => {
            clock += 600;
            return clock;
          },
        }
      )
    ).rejects.toThrow("Status code 400 is not ok");
  });
});
