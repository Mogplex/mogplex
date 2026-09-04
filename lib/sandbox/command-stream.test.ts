import { describe, expect, it } from "vitest";
import type { Command } from "@vercel/sandbox";
import {
  isResumableCommandStreamError,
  streamCommandLogsWithResume,
} from "./command-stream";

type Line = { stream: "stdout" | "stderr"; data: string };
type LogsStep = { upto: number; throwError?: unknown };
type WaitStep = { exitCode: number } | { throwError: unknown };

/**
 * Builds a fake detached Command. Each logs() call replays the command's whole
 * buffered output from the start (matching the real ndjson endpoint) up to the
 * step's `upto`, then optionally throws to simulate the request being capped.
 * Each wait() call returns or throws per its step; a capped wait() throws a
 * resumable error, a finished command returns its exit code. The last step is
 * reused once its list is exhausted.
 */
function makeCommand(
  logsPlan: LogsStep[],
  allLines: Line[],
  waitPlan: WaitStep[]
) {
  let logsCall = 0;
  let waitCall = 0;
  const command = {
    cmdId: "cmd_test",
    logs() {
      const plan = logsPlan[Math.min(logsCall, logsPlan.length - 1)];
      logsCall += 1;
      const replay = allLines.slice(0, plan.upto);
      async function* gen() {
        for (const line of replay) yield line;
        if (plan.throwError) throw plan.throwError as Error;
      }
      return gen();
    },
    async wait() {
      const plan = waitPlan[Math.min(waitCall, waitPlan.length - 1)];
      waitCall += 1;
      if ("throwError" in plan) throw plan.throwError as Error;
      return { exitCode: plan.exitCode };
    },
  } as unknown as Command;
  return { command, logsCalls: () => logsCall, waitCalls: () => waitCall };
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
  const allLines: Line[] = [
    { stream: "stdout", data: "a" },
    { stream: "stdout", data: "b" },
    { stream: "stderr", data: "c" },
    { stream: "stdout", data: "d" },
    { stream: "stdout", data: "e" },
  ];

  it("should emit each line once when the live stream is capped before completion", async () => {
    // Live stream sends 3 lines then the request is capped; wait() reports the
    // command finished, and the flush after wait picks up the rest.
    const { command } = makeCommand(
      [
        { upto: 3, throwError: new Error("Status code 400 is not ok") },
        { upto: 5 },
      ],
      allLines,
      [{ exitCode: 0 }]
    );
    const seen: Line[] = [];

    const exitCode = await streamCommandLogsWithResume(
      {
        command,
        onLog: (log) => {
          seen.push(log);
        },
        reconnectDelayMs: 0,
      },
      { delay: async () => {} }
    );

    expect(exitCode).toBe(0);
    expect(seen).toEqual(allLines);
  });

  it("should return the exit code from a clean single pass", async () => {
    const only: Line[] = [{ stream: "stdout", data: "only" }];
    const { command, waitCalls } = makeCommand([{ upto: 1 }], only, [
      { exitCode: 0 },
    ]);
    const seen: Line[] = [];

    const exitCode = await streamCommandLogsWithResume(
      {
        command,
        onLog: (log) => {
          seen.push(log);
        },
        reconnectDelayMs: 0,
      },
      { delay: async () => {} }
    );

    expect(exitCode).toBe(0);
    expect(seen).toEqual(only);
    expect(waitCalls()).toBe(1);
  });

  it("should wait across repeated caps until a long command finishes", async () => {
    const lines: Line[] = [
      { stream: "stdout", data: "start" },
      { stream: "stdout", data: "mid" },
      { stream: "stdout", data: "end" },
    ];
    // Live stream caps after one line; wait() reports the command still running
    // (capped) twice, each retry flushing more snapshot output, then it exits.
    const { command, waitCalls } = makeCommand(
      [
        { upto: 1, throwError: new Error("Status code 400 is not ok") },
        { upto: 2 },
        { upto: 3 },
        { upto: 3 },
      ],
      lines,
      [
        { throwError: new Error("Status code 400 is not ok") },
        { throwError: new Error("Status code 400 is not ok") },
        { exitCode: 0 },
      ]
    );
    const seen: Line[] = [];
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
      { delay: async () => {} }
    );

    expect(exitCode).toBe(0);
    expect(seen).toEqual(lines);
    expect(reconnects).toEqual([1, 2]);
    expect(waitCalls()).toBe(3);
  });

  it("should rethrow a non-resumable error raised by wait", async () => {
    const { command } = makeCommand(
      [{ upto: 0 }],
      [],
      [{ throwError: new Error("prompt was rejected") }]
    );

    await expect(
      streamCommandLogsWithResume(
        { command, onLog: () => {}, reconnectDelayMs: 0 },
        { delay: async () => {} }
      )
    ).rejects.toThrow("prompt was rejected");
  });

  it("should rethrow a non-resumable error raised by the live stream", async () => {
    const { command } = makeCommand(
      [{ upto: 0, throwError: new Error("prompt was rejected") }],
      [],
      [{ exitCode: 0 }]
    );

    await expect(
      streamCommandLogsWithResume(
        { command, onLog: () => {}, reconnectDelayMs: 0 },
        { delay: async () => {} }
      )
    ).rejects.toThrow("prompt was rejected");
  });

  it("should fail a still-running command once the wall-clock deadline passes", async () => {
    const { command } = makeCommand(
      [{ upto: 0 }],
      [],
      [{ throwError: new Error("Status code 400 is not ok") }]
    );
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
